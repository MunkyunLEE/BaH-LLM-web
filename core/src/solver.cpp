#include "solver.hpp"

#include <Eigen/SparseLU>
#include <Eigen/SparseCholesky>
#include <algorithm>
#include <random>
#include <set>
#include <cstdio>
#include <cstdlib>
static bool dbg() { static int v = std::getenv("BH_DEBUG") ? 1 : 0; return v; }

namespace bh {

static bool solveFree(const SpMat& K, const std::vector<int>& fr, const MatX& rhs, MatX& sol, bool sym = true) {
    int n = (int)K.rows(), nf = (int)fr.size();
    std::vector<int> map(n, -1);
    for (int i = 0; i < nf; i++) map[fr[i]] = i;
    std::vector<Trip> T;
    T.reserve(K.nonZeros());
    for (int c = 0; c < K.outerSize(); c++)
        for (SpMat::InnerIterator it(K, c); it; ++it) {
            int r = map[it.row()], q = map[it.col()];
            if (r >= 0 && q >= 0) T.emplace_back(r, q, it.value());
        }
    SpMat Kf(nf, nf);
    Kf.setFromTriplets(T.begin(), T.end());
    Kf.makeCompressed();
    sol = MatX::Zero(n, rhs.cols());
    MatX b(nf, rhs.cols());
    for (int i = 0; i < nf; i++) b.row(i) = rhs.row(fr[i]);
    MatX x;
    bool ok = false;
    if (sym) {
        Eigen::SimplicialLDLT<SpMat, Eigen::Lower, Eigen::AMDOrdering<int>> ld;
        ld.compute(Kf);
        if (ld.info() == Eigen::Success) {
            x = ld.solve(b);
            ok = x.allFinite();
            if (ok) {
                double rn = (Kf * x - b).norm(), bn = b.norm();
                ok = rn <= 1e-8 * std::max(bn, 1e-300) || rn <= 1e-12;
            }
        }
    }
    if (!ok) {
        Eigen::SparseLU<SpMat, Eigen::COLAMDOrdering<int>> lu;
        lu.compute(Kf);
        if (lu.info() != Eigen::Success) return false;
        x = lu.solve(b);
        if (!x.allFinite()) return false;
    }
    for (int i = 0; i < nf; i++) sol.row(fr[i]) = x.row(i);
    return true;
}

void Analysis::setup(const Input& in, const Settings& s) {
    set = s;
    m = build(in);
    int nd = m.ndof();
    fixed = fixedFromSupp(m, in.supp, m.nInput);
    F = VecX::Zero(nd);
    Ubar = VecX::Zero(nd);
    std::set<int> fx(fixed.begin(), fixed.end());
    for (auto& f : in.forces) {
        for (int i = 0; i < (int)m.orig.size(); i++)
            if (m.orig[i] == f.first) {
                F.segment<3>(3 * i) += f.second;
                break;
            }
    }
    for (auto& d : in.disp)
        for (int i = 0; i < (int)m.orig.size(); i++)
            if (m.orig[i] == d.first)
                for (int q = 0; q < 3; q++)
                    if (std::isfinite(d.second[q])) {
                        if (d.second[q] == 0)
                            fx.insert(3 * i + q);
                        else
                            Ubar[3 * i + q] = d.second[q];
                    }
    fixed.assign(fx.begin(), fx.end());
    for (int i = 0; i < nd; i++)
        if (Ubar[i] != 0 && !fx.count(i)) imp.push_back(i);
    std::set<int> im(imp.begin(), imp.end());
    for (int i = 0; i < nd; i++)
        if (!fx.count(i) && !im.count(i)) free.push_back(i);
    if (!in.pressures.empty()) {
        pl = buildPressure(m, in.pressures);
        hasPressure = !pl.tri.empty();
        for (int l : pl.local)
            if (l) follower = true;
    }
    if (set.contact) {
        ct.reset(new Contact());
        ct->hingeBarrier = set.hingeBarrier;
        ct->init(m, set.gap, set.kappa, in.sym);
    }
    st = initState(m);
    U = VecX::Zero(nd);
    Uprev = U;
    Fprev = VecX::Zero(nd);
    if (set.type == "force") {
        bl = set.lambda0;
        lmd = 0;
        icrm = 0;
        if (F.norm() == 0 && !hasPressure) {
            done = true;
            status = "no_force";
        }
        if (!imp.empty()) notes.push_back("force_mode_ignores_nonzero_displacement");
    } else if (set.type == "displacement") {
        if (imp.empty() && F.norm() == 0 && !hasPressure) {
            done = true;
            status = "no_load";
        }
        legEnd.push_back(Ubar);
        if (set.cycles > 0) {
            VecX back = VecX::Zero(nd);
            for (int i : imp) back[i] = -(Ubar[i] > 0 ? 1.0 : -1.0) * set.cycleBack;
            legEnd.clear();
            for (int c = 0; c < set.cycles; c++) {
                legEnd.push_back(Ubar);
                if (set.cycleBack > 0) legEnd.push_back(back);
                legEnd.push_back(VecX::Zero(nd));
            }
        }
        leg = 0;
        legStart = VecX::Zero(nd);
        Fdsp = (legEnd[0] - legStart) / set.dispStep;
        dspmvd = 0;
        mv = 1;
        damping = 1;
        attmpts = 0;
    }
    frames.push_back(record(U, 0, 0, 0));
}

VecX Analysis::fext(const VecX& Uc, double scale, std::vector<Trip>* Kp) {
    VecX f = scale * F;
    if (hasPressure) {
        VecX fp;
        std::vector<Trip> T;
        pressureForce(m, pl, Uc, fp, Kp ? &T : nullptr);
        f += scale * fp;
        if (Kp)
            for (auto& t : T) Kp->emplace_back(t.row(), t.col(), scale * t.value());
    }
    return f;
}

void Analysis::evalSystem(const VecX& Uc, double lam, VecX& R, SpMat& K, ContactInfo* ci) {
    VecX IF;
    internal(m, Uc, st, IF, &K, nullptr, true);
    std::vector<Trip> extra;
    if (ct) {
        MatX Xc = current(m, Uc);
        ContactInfo info = ct->add(m, Xc, IF, &extra);
        if (ci) *ci = info;
    }
    std::vector<Trip> Kp;
    VecX f = fext(Uc, lam, follower ? &Kp : nullptr);
    for (auto& t : Kp) extra.emplace_back(t.row(), t.col(), -t.value());
    if (!extra.empty()) {
        SpMat E(K.rows(), K.cols());
        E.setFromTriplets(extra.begin(), extra.end());
        K += E;
    }
    R = f - IF;
}

Frame Analysis::record(const VecX& Uc, double lam, double s, int iters) {
    Frame fr;
    fr.U = Uc;
    fr.lam = lam;
    fr.s = s;
    fr.iters = iters;
    VecX IF;
    ElemOut o;
    internal(m, Uc, st, IF, nullptr, &o, false);
    fr.US = o.W.sum();
    for (size_t i = 0; i < m.hinges.size(); i++) {
        int k = m.hinges[i].kind;
        if (k == FOLD)
            fr.UF += o.Uh[i];
        else if (k == PANEL_BEND)
            fr.UB += o.Uh[i];
        else
            fr.UE += o.Uh[i];
    }
    fr.Wp = st.wpBar + st.wpHinge + o.dWp.sum();
    fr.Sx = o.Sx;
    int nn = (int)m.X.rows();
    fr.Eb = VecX::Zero(nn);
    fr.Ef = VecX::Zero(nn);
    fr.Ebd = VecX::Zero(nn);
    for (size_t e = 0; e < m.bars.size(); e++) {
        fr.Eb[m.bars[e][0]] += 0.5 * o.W[e];
        fr.Eb[m.bars[e][1]] += 0.5 * o.W[e];
    }
    for (size_t i = 0; i < m.hinges.size(); i++) {
        auto& h = m.hinges[i];
        VecX& t = h.kind == FOLD ? fr.Ef : fr.Ebd;
        t[h.n[0]] += 0.5 * o.Uh[i];
        t[h.n[1]] += 0.5 * o.Uh[i];
    }
    if (ct) {
        VecX g = VecX::Zero(m.ndof());
        ContactInfo ci = ct->add(m, current(m, Uc), g, nullptr);
        fr.Uc = ci.energy;
        fr.contactPairs = ci.pairs + ci.hingePairs;
        fr.minDist = ci.minDist;
        IF += g;
    }
    VecX f = fext(Uc, lam, nullptr);
    VecX ext = set.type == "force" ? f : VecX(f);
    if (set.type == "displacement")
        for (int i : imp) ext[i] = IF[i];
    VecX du = Uc - Uprev;
    Wext += 0.5 * (ext + Fprev).dot(du);
    Fprev = ext;
    Uprev = Uc;
    fr.Wext = Wext;
    fr.Fimp = IF;
    return fr;
}

bool Analysis::stopNow(const VecX& Uc) const {
    for (auto& r : set.stop) {
        for (int i = 0; i < (int)m.orig.size(); i++)
            if (m.orig[i] == r.node) {
                double v = Uc[3 * i + r.dir];
                if (std::abs(v) >= std::abs(r.value)) return true;
                break;
            }
    }
    return false;
}

void Analysis::stepForce() {
    int nd = m.ndof();
    if (icrm >= set.maxIcr || stopNow(U) || (set.lamMax > 0 && std::abs(lmd) >= set.lamMax)) {
        done = true;
        status = icrm >= set.maxIcr ? "max_increments" : (set.lamMax > 0 && std::abs(lmd) >= set.lamMax ? "load_reached" : "stop_criterion");
        return;
    }
    icrm++;
    int iter = 0;
    double err = 1;
    MatX MUL = MatX::Zero(nd, 2);
    while (err > set.tol && iter < set.maxIter) {
        iter++;
        VecX R;
        SpMat K;
        VecX Fu = fext(U, 1.0, nullptr);
        evalSystem(U, lmd, R, K, nullptr);
        MatX MRS(nd, 2);
        MRS.col(0) = Fu;
        MRS.col(1) = R;
        if (!solveFree(K, free, MRS, MUL, !follower)) {
            err = INF;
            break;
        }
        VecX dUp = MUL.col(0), dUr = MUL.col(1);
        if (iter == 1) dUr.setZero();
        double dl;
        if (iter == 1) {
            if (icrm == 1) {
                sinal = dUp.dot(dUp) > 0 ? 1.0 : (dUp.dot(dUp) < 0 ? -1.0 : 0.0);
                dl = bl;
                numgsp = dUp.dot(dUp);
            } else {
                double sg = dupp1.dot(dUp);
                sinal = sinal * (sg > 0 ? 1.0 : (sg < 0 ? -1.0 : 0.0));
                double gsp = numgsp / dUp.dot(dUp);
                dl = sinal * bl * std::sqrt(gsp);
            }
            dupp1 = dUp;
            dupc1 = dUp;
        } else {
            dl = -dupc1.dot(dUr) / dupc1.dot(dUp);
        }
        VecX dUt = dl * dUp + dUr;
        if (ct) {
            double a = ct->stepSize(m, current(m, U), dUt);
            if (a < 1) {
                dUt *= 0.8 * a;
                dl *= 0.8 * a;
            }
        }
        U += dUt;
        err = 0;
        for (int i : free) err += dUt[i] * dUt[i];
        err = std::sqrt(err);
        lmd += dl;
        if (dbg()) std::fprintf(stderr, "  icrm %d iter %d err %.10g dl %.10g\n", icrm, iter, err, dl);
        if (err > 1e8) break;
    }
    if (iter > 15 || !std::isfinite(err)) {
        bl /= 2;
        icrm--;
        int k = std::max(icrm, 1);
        if ((int)Uhis.size() >= k) {
            U = Uhis[k - 1];
            lmd = Fhis[k - 1];
            st = Shis[k - 1];
        } else {
            U.setZero();
            lmd = 0;
            st = initState(m);
        }
        notes.push_back("reduce_radius");
        if (bl < 1e-14) {
            done = true;
            status = "radius_underflow";
        }
        return;
    }
    if (iter < 3) bl *= 1.5;
    VecX IF;
    ElemOut o;
    internal(m, U, st, IF, nullptr, &o, false);
    commitState(m, st, o);
    if ((int)Uhis.size() >= icrm) {
        Uhis.resize(icrm - 1);
        Fhis.resize(icrm - 1);
        Shis.resize(icrm - 1);
    }
    Uhis.push_back(U);
    Fhis.push_back(lmd);
    Shis.push_back(st);
    if ((int)frames.size() > icrm) frames.resize(icrm);
    frames.push_back(record(U, lmd, lmd, iter));
}

void Analysis::stepDisp() {
    int nd = m.ndof();
    bool legDone = set.exact ? dspmvd >= 1 - 1e-12 : dspmvd > 1;
    if (legDone) {
        leg++;
        if (leg >= (int)legEnd.size()) {
            done = true;
            status = "completed";
            return;
        }
        legStart = legEnd[leg - 1];
        Fdsp = (legEnd[leg] - legStart) / set.dispStep;
        dspmvd = 0;
        mv = 1;
        damping = 1;
        attmpts = 0;
    }
    if (stopNow(U)) {
        done = true;
        status = "stop_criterion";
        return;
    }
    if (attmpts > 20) {
        done = true;
        status = "no_convergence";
        return;
    }
    double step = mv;
    if (set.exact) step = std::min(mv, (1 - dspmvd) * set.dispStep);
    icrm++;
    VecX Ubak = U;
    State sbak = st;
    double sNew = leg == 0 ? std::min(1.0, dspmvd + step / set.dispStep) : 1.0;
    VecX pred = step * Fdsp;
    for (int i : fixed) pred[i] = 0;
    bool fail = false;
    if (ct) {
        double a = ct->stepSize(m, current(m, U), pred);
        if (a < 1) {
            fail = true;
            if (++ctBlocked > 40) {
                done = true;
                status = "contact_blocked";
                return;
            }
        }
    }
    int iter = 0;
    double err = 1;
    if (!fail) {
        U += pred;
        for (int i : fixed) U[i] = 0;
        while (err > set.tol && iter < set.maxIter) {
            iter++;
            VecX R;
            SpMat K;
            evalSystem(U, sNew, R, K, nullptr);
            MatX sol;
            if (!solveFree(K, free, R, sol, !follower)) {
                err = INF;
                break;
            }
            VecX dU = sol.col(0);
            err = 0;
            for (int i : free) err += dU[i] * dU[i];
            err = std::sqrt(err);
            double a = 1;
            if (ct) a = ct->stepSize(m, current(m, U), damping * dU);
            U += a * damping * dU;
            if (!std::isfinite(err)) break;
        }
    }
    bool bad = fail || !std::isfinite(err) || iter >= ((mv > 1) + 1) * set.maxIter / (damping + 1);
    if (bad) {
        attmpts++;
        icrm--;
        if (attmpts <= 10) {
            mv *= 0.5;
        } else {
            mv = std::max(mv, 1.0) * 1.5;
            damping *= 0.75;
        }
        if (set.exact) {
            U = Ubak;
            st = sbak;
        } else {
            int k = std::max(icrm, 1);
            U = (int)Uhis.size() >= k ? Uhis[k - 1] : VecX::Zero(nd);
            st = (int)Shis.size() >= k ? Shis[k - 1] : initState(m);
        }
        notes.push_back("retry");
        return;
    }
    dspmvd += step / set.dispStep;
    if (step >= 0.25) ctBlocked = 0;
    attmpts = 0;
    damping = 1;
    if (mv < 1)
        mv = std::min(mv * 1.1, 1.0);
    else
        mv = std::max(mv * 0.9, 1.0);
    VecX IF;
    ElemOut o;
    internal(m, U, st, IF, nullptr, &o, false);
    commitState(m, st, o);
    if ((int)Uhis.size() >= icrm) {
        Uhis.resize(icrm - 1);
        Shis.resize(icrm - 1);
    }
    Uhis.push_back(U);
    Shis.push_back(st);
    double sRec = leg == 0 ? std::min(1.0, dspmvd) : 1.0;
    frames.push_back(record(U, sRec, leg + std::min(1.0, dspmvd), iter));
}

void Analysis::step(int maxIncr) {
    for (int k = 0; k < maxIncr && !done; k++) {
        if (set.type == "force")
            stepForce();
        else if (set.type == "displacement")
            stepDisp();
        else {
            done = true;
            status = "not_incremental";
        }
    }
}

std::string Analysis::modal(std::vector<double>& eig, std::vector<VecX>& shapes, int& rigid) {
    int nd = m.ndof();
    VecX Uc = set.modalDeformed && !frames.empty() ? frames.back().U : VecX::Zero(nd);
    VecX IF;
    SpMat K;
    internal(m, Uc, st, IF, &K, nullptr, false);
    std::set<int> fx(fixed.begin(), fixed.end());
    for (int i : imp) fx.insert(i);
    std::vector<int> fr;
    for (int i = 0; i < nd; i++)
        if (!fx.count(i)) fr.push_back(i);
    int nf = (int)fr.size();
    MatX Kd = MatX(K);
    MatX Kf(nf, nf);
    for (int a = 0; a < nf; a++)
        for (int b = 0; b < nf; b++) Kf(a, b) = 0.5 * (Kd(fr[a], fr[b]) + Kd(fr[b], fr[a]));
    VecX lam;
    MatX V;
    std::string msg;
    if (set.useMass) {
        VecX Md(nf);
        for (int a = 0; a < nf; a++) Md[a] = m.mass[fr[a] / 3];
        if (Md.minCoeff() <= 0) return "zero_mass";
        VecX s = Md.cwiseSqrt().cwiseInverse();
        MatX Ks = s.asDiagonal() * Kf * s.asDiagonal();
        Eigen::SelfAdjointEigenSolver<MatX> es(Ks);
        lam = es.eigenvalues();
        V = s.asDiagonal() * es.eigenvectors();
    } else {
        Eigen::SelfAdjointEigenSolver<MatX> es(Kf);
        lam = es.eigenvalues();
        V = es.eigenvectors();
    }
    double mx = lam.cwiseAbs().maxCoeff();
    rigid = 0;
    for (int i = 0; i < lam.size(); i++)
        if (std::abs(lam[i]) < 1e-10 * std::max(mx, 1e-300)) rigid++;
    int k = std::min(set.modes + rigid, (int)lam.size());
    for (int i = 0; i < k; i++) {
        eig.push_back(lam[i]);
        VecX sh = VecX::Zero(nd);
        for (int a = 0; a < nf; a++) sh[fr[a]] = V(a, i);
        double am = sh.cwiseAbs().maxCoeff();
        if (am > 0) sh /= am;
        shapes.push_back(sh);
    }
    return msg;
}

static void constraints(const Model& m, const VecX& x, bool rigidPanels, VecX& g, MatX& J, std::vector<int>* hidOut) {
    int nb = (int)m.bars.size(), nd = m.ndof();
    std::vector<int> hid;
    if (rigidPanels)
        for (size_t i = 0; i < m.hinges.size(); i++)
            if (m.hinges[i].kind != FOLD) hid.push_back((int)i);
    g.resize(nb + hid.size());
    J = MatX::Zero(nb + hid.size(), nd);
    MatX Xc = current(m, x);
    for (int e = 0; e < nb; e++) {
        int a = m.bars[e][0], b = m.bars[e][1];
        Vec3 d = (Xc.row(b) - Xc.row(a)).transpose();
        double L = d.norm();
        Vec3 n = d / L;
        g[e] = L - m.L[e];
        J.block<1, 3>(e, 3 * a) = -n.transpose();
        J.block<1, 3>(e, 3 * b) = n.transpose();
    }
    for (size_t r = 0; r < hid.size(); r++) {
        const Hinge& h = m.hinges[hid[r]];
        if (h.ghostAxis >= 0) continue;
        Vec3 xj = Xc.row(h.n[0]), xk = Xc.row(h.n[1]), xi = Xc.row(h.n[2]), xl = Xc.row(h.n[3]);
        Eigen::Matrix<double, 12, 1> Jh;
        dihedralGrad(xj, xk, xi, xl, Jh);
        double th = dihedral(xj, xk, xi, xl);
        double d = th - h.th0;
        d -= 2 * PI * std::round(d / (2 * PI));
        g[nb + r] = d;
        for (int q = 0; q < 4; q++) J.block<1, 3>(nb + r, 3 * h.n[q]) += Jh.segment<3>(3 * q).transpose();
    }
    if (hidOut) *hidOut = hid;
}

VecX Analysis::hingeAngles(const VecX& x) const {
    MatX Xc = current(m, x);
    VecX a(m.hinges.size());
    for (size_t i = 0; i < m.hinges.size(); i++) {
        const Hinge& h = m.hinges[i];
        Vec3 xl = Xc.row(h.n[3]);
        if (h.ghostAxis >= 0) {
            xl = Xc.row(h.n[2]);
            xl[h.ghostAxis] = 2 * h.ghostC - xl[h.ghostAxis];
        }
        a[i] = dihedral(Xc.row(h.n[0]), Xc.row(h.n[1]), Xc.row(h.n[2]), xl);
    }
    return a;
}

std::vector<int> Analysis::kinFree() const {
    int nd = m.ndof();
    std::set<int> fx(fixed.begin(), fixed.end());
    if (fixed.empty() && !m.panels.empty()) {
        auto& f = m.panels[0];
        fx = {3 * f[0], 3 * f[0] + 1, 3 * f[0] + 2, 3 * f[1] + 1, 3 * f[1] + 2, 3 * f[2] + 2};
    }
    std::vector<int> fr;
    for (int i = 0; i < nd; i++)
        if (!fx.count(i)) fr.push_back(i);
    return fr;
}

int Analysis::hingeOfEdge(int a, int b) const {
    for (size_t i = 0; i < m.hinges.size(); i++) {
        auto& h = m.hinges[i];
        if ((h.edge[0] == a && h.edge[1] == b) || (h.edge[0] == b && h.edge[1] == a)) return (int)i;
    }
    return -1;
}

void Analysis::dofInfo(int& nc, int& nfree, int& rank, int& mech, int& selfStress) const {
    int nd = m.ndof();
    VecX x = VecX::Zero(nd), g;
    MatX J;
    constraints(m, x, true, g, J, nullptr);
    std::set<int> fx(fixed.begin(), fixed.end());
    std::vector<int> fr;
    for (int i = 0; i < nd; i++)
        if (!fx.count(i)) fr.push_back(i);
    MatX Jf(J.rows(), fr.size());
    for (size_t c = 0; c < fr.size(); c++) Jf.col(c) = J.col(fr[c]);
    VecX sv = Jf.size() ? VecX(Eigen::BDCSVD<MatX>(Jf).singularValues()) : VecX();
    double tol = 1e-7 * (sv.size() ? sv.maxCoeff() : 1.0);
    rank = 0;
    for (int i = 0; i < sv.size(); i++)
        if (sv[i] > tol) rank++;
    nc = (int)J.rows();
    nfree = (int)fr.size();
    int rig = fixed.empty() ? 6 : 0;
    mech = std::max(nfree - rank - rig, 0);
    selfStress = nc - rank;
}

static void hingeGradRow(const Model& m, const MatX& Xc, int hi, MatX& A, int row) {
    const Hinge& h = m.hinges[hi];
    Eigen::Matrix<double, 12, 1> Jh;
    dihedralGrad(Xc.row(h.n[0]), Xc.row(h.n[1]), Xc.row(h.n[2]), Xc.row(h.n[3]), Jh);
    for (int k = 0; k < 4; k++) A.block<1, 3>(row, 3 * h.n[k]) += Jh.segment<3>(3 * k).transpose();
}

void Analysis::nullModes(std::vector<VecX>& modes, MatX& rates, std::vector<int>& foldIdx) const {
    int nd = m.ndof();
    VecX x = VecX::Zero(nd), g;
    MatX J;
    constraints(m, x, true, g, J, nullptr);
    std::vector<int> fr = kinFree();
    MatX Jf(J.rows(), fr.size());
    for (size_t c = 0; c < fr.size(); c++) Jf.col(c) = J.col(fr[c]);
    Eigen::JacobiSVD<MatX> svd(Jf, Eigen::ComputeFullV);
    VecX sv = svd.singularValues();
    double tol = 1e-7 * (sv.size() ? sv.maxCoeff() : 1.0);
    int r = 0;
    for (int i = 0; i < sv.size(); i++)
        if (sv[i] > tol) r++;
    MatX V = svd.matrixV();
    modes.clear();
    for (int c = r; c < V.cols(); c++) {
        VecX md = VecX::Zero(nd);
        for (size_t q = 0; q < fr.size(); q++) md[fr[q]] = V(q, c);
        modes.push_back(md);
    }
    foldIdx.clear();
    for (size_t i = 0; i < m.hinges.size(); i++)
        if (m.hinges[i].kind == FOLD && m.hinges[i].ghostAxis < 0) foldIdx.push_back((int)i);
    MatX A = MatX::Zero(foldIdx.size(), nd);
    MatX Xc = current(m, x);
    for (size_t q = 0; q < foldIdx.size(); q++) hingeGradRow(m, Xc, foldIdx[q], A, (int)q);
    rates.resize(modes.size(), foldIdx.size());
    for (size_t k = 0; k < modes.size(); k++) rates.row(k) = (A * modes[k]).transpose();
}

static double wrapPi(double d) { return d - 2 * PI * std::round(d / (2 * PI)); }

void Analysis::foldPath(const std::vector<int>& drv, const VecX& targets, int steps, std::vector<VecX>& xs, std::vector<VecX>& angles, std::vector<double>& err) const {
    int nd = m.ndof(), nds = (int)drv.size();
    std::vector<int> fr = kinFree();
    VecX x = VecX::Zero(nd), g;
    MatX J;
    VecX a0 = hingeAngles(x);
    VecX thStart(nds);
    for (int q = 0; q < nds; q++) thStart[q] = a0[drv[q]];
    xs.assign(1, x);
    angles.assign(1, a0);
    err.clear();
    double tol = 1e-10 * std::max(1.0, m.L.mean());
    auto system = [&](const VecX& goal, VecX& r, MatX& M) {
        constraints(m, x, true, g, J, nullptr);
        MatX Xc = current(m, x);
        MatX A = MatX::Zero(nds, nd);
        VecX cur = hingeAngles(x);
        VecX rd(nds);
        for (int q = 0; q < nds; q++) {
            hingeGradRow(m, Xc, drv[q], A, q);
            rd[q] = wrapPi(cur[drv[q]] - goal[q]);
        }
        r.resize(g.size() + nds);
        r << g, rd;
        M.resize(r.size(), fr.size());
        for (size_t c = 0; c < fr.size(); c++) {
            M.block(0, c, g.size(), 1) = J.col(fr[c]);
            M.block(g.size(), c, nds, 1) = A.col(fr[c]);
        }
    };
    for (int s = 1; s <= steps; s++) {
        VecX goal = thStart + (targets - thStart) * double(s) / steps;
        VecX r;
        MatX M;
        system(goal, r, M);
        VecX rhs = VecX::Zero(r.size());
        rhs.tail(nds) = -r.tail(nds);
        VecX v = M.completeOrthogonalDecomposition().solve(rhs);
        for (size_t c = 0; c < fr.size(); c++) x[fr[c]] += v[c];
        double rprev = INF, rn = INF;
        for (int it = 0; it < 30; it++) {
            system(goal, r, M);
            rn = r.cwiseAbs().maxCoeff();
            if (rn < tol || (it > 1 && rn < 1e3 * tol && rn > 0.5 * rprev)) break;
            rprev = rn;
            VecX dx = M.completeOrthogonalDecomposition().solve(-r);
            for (size_t c = 0; c < fr.size(); c++) x[fr[c]] += dx[c];
        }
        xs.push_back(x);
        angles.push_back(hingeAngles(x));
        err.push_back(rn);
    }
}

int Analysis::solutionSpace(const std::vector<int>& hid, int ndir, double amp, int steps, std::vector<std::vector<Vec3>>& paths) const {
    std::vector<VecX> modes;
    MatX rates;
    std::vector<int> fi;
    nullModes(modes, rates, fi);
    int k = (int)modes.size();
    paths.clear();
    if (k == 0 || fi.empty()) return k;
    std::vector<VecX> dirs;
    if (k == 1) {
        dirs.push_back(VecX::Constant(1, 1.0));
        dirs.push_back(VecX::Constant(1, -1.0));
    } else {
        std::mt19937 rng(0);
        std::normal_distribution<double> nd01(0.0, 1.0);
        for (int q = 0; q < ndir; q++) {
            VecX d(k);
            for (int c = 0; c < k; c++) d[c] = nd01(rng);
            dirs.push_back(d / d.norm());
        }
    }
    std::vector<int> drvK;
    if (k > 1) {
        std::vector<int> order(fi.size());
        for (size_t c = 0; c < fi.size(); c++) order[c] = (int)c;
        VecX tot = rates.cwiseAbs().colwise().sum().transpose();
        std::stable_sort(order.begin(), order.end(), [&](int a, int b) { return tot[a] > tot[b]; });
        std::vector<int> cols;
        for (int c : order) {
            std::vector<int> cand = cols;
            cand.push_back(c);
            MatX sub(k, cand.size());
            for (size_t q = 0; q < cand.size(); q++) sub.col(q) = rates.col(cand[q]);
            Eigen::FullPivLU<MatX> lu(sub);
            if (lu.rank() == (int)cand.size()) cols = cand;
            if ((int)cols.size() == k) break;
        }
        drvK = cols;
    }
    VecX th0 = hingeAngles(VecX::Zero(m.ndof()));
    for (auto& d : dirs) {
        VecX rate = rates.transpose() * d;
        std::vector<int> cols = drvK;
        if (k == 1) {
            int j = 0;
            rate.cwiseAbs().maxCoeff(&j);
            cols = {j};
        }
        if (cols.empty()) continue;
        VecX dr(cols.size());
        for (size_t q = 0; q < cols.size(); q++) dr[q] = rate[cols[q]];
        double mx = dr.cwiseAbs().maxCoeff();
        if (mx == 0) continue;
        std::vector<int> drv;
        VecX tgt(cols.size());
        for (size_t q = 0; q < cols.size(); q++) {
            drv.push_back(fi[cols[q]]);
            tgt[q] = std::min(std::max(th0[fi[cols[q]]] + amp * dr[q] / mx, 1e-3), 2 * PI - 1e-3);
        }
        std::vector<VecX> xs, ang;
        std::vector<double> err;
        foldPath(drv, tgt, steps, xs, ang, err);
        int nOk = (int)err.size();
        for (size_t q = 0; q < err.size(); q++)
            if (!(err[q] < 1e-6)) {
                nOk = (int)q;
                break;
            }
        std::vector<Vec3> p;
        for (int q = 0; q <= nOk; q++) {
            Vec3 v = Vec3::Zero();
            for (size_t c = 0; c < hid.size() && c < 3; c++) v[c] = hid[c] >= 0 ? ang[q][hid[c]] : 0.0;
            p.push_back(v);
        }
        paths.push_back(p);
    }
    return k;
}

std::string Analysis::kinematics(int& mech, int& selfStress, int& rank, std::vector<VecX>& path, std::vector<VecX>& angles) {
    int nc = 0, nfree = 0;
    dofInfo(nc, nfree, rank, mech, selfStress);
    path.assign(1, VecX::Zero(m.ndof()));
    angles.assign(1, hingeAngles(path[0]));
    if (set.drivers.empty() && !set.driverEdges.empty()) {
        for (auto& e : set.driverEdges) {
            int hit = hingeOfEdge(e[0], e[1]);
            if (hit < 0) return "driver_not_found";
            set.drivers.push_back(hit);
        }
    }
    if (set.drivers.empty()) return "";
    int nds = (int)set.drivers.size();
    VecX tgt(nds);
    for (int q = 0; q < nds; q++) tgt[q] = q < (int)set.targets.size() ? set.targets[q] : angles[0][set.drivers[q]];
    std::vector<VecX> xs, ang;
    std::vector<double> err;
    foldPath(set.drivers, tgt, set.kinSteps, xs, ang, err);
    for (size_t q = 1; q < xs.size(); q++) {
        if (!(err[q - 1] < 1e-6)) return "path_incompatible";
        path.push_back(xs[q]);
        angles.push_back(ang[q]);
    }
    return "";
}

}
