#include "bh.hpp"

namespace bh {

void barLaw(int cm, double C0, double a1, double a2, double Ex, double& S, double& C, double& W) {
    if (cm == SVK) {
        S = C0 * Ex;
        C = C0;
        W = 0.5 * C0 * Ex * Ex;
        return;
    }
    double q = 2 * Ex + 1;
    double p = q > 0 ? std::sqrt(q) : 0.0;
    p = std::max(p, 1e-12);
    double c = C0 / (a1 - a2);
    C = c * ((a1 - 2) * std::pow(p, a1 - 4) - (a2 - 2) * std::pow(p, a2 - 4));
    S = c * (std::pow(p, a1 - 2) - std::pow(p, a2 - 2));
    W = c * ((std::pow(p, a1) - 1) / a1 - (std::pow(p, a2) - 1) / a2);
}

void hingeLaw(const Hinge& h, double he, double& M, double& k, double& U) {
    double s = h.factor * h.L0;
    double kp = h.kp, h0 = h.th0;
    if (h.cm == ENHANCED) {
        double L = h.th1, R = h.th2;
        double pl = PI / L, pr = PI / (2 * PI - R);
        if (he < L) {
            M = kp * (L - h0) + kp * std::tan(pl / 2 * (he - L)) / (pl / 2);
            double c = std::cos(pl / 2 * (he - L));
            k = kp / (c * c);
            U = 0.5 * kp * (h0 - L) * (h0 - L) + kp * (h0 - L) * (L - he) - 4 * kp / (pl * pl) * std::log(std::abs(std::cos(pl / 2 * (L - he))));
        } else if (he > R) {
            M = kp * (R - h0) + kp * std::tan(pr / 2 * (he - R)) / (pr / 2);
            double c = std::cos(pr / 2 * (he - R));
            k = kp / (c * c);
            U = 0.5 * kp * (R - h0) * (R - h0) + kp * (R - h0) * (he - R) - 4 * kp / (pr * pr) * std::log(std::abs(std::cos(pr / 2 * (he - R))));
        } else {
            M = kp * (he - h0);
            k = kp;
            U = 0.5 * kp * (he - h0) * (he - h0);
        }
    } else if (h.cm == SUPERLINEAR) {
        double d = he - h0, a = std::abs(d);
        M = (d > 0 ? 1.0 : (d < 0 ? -1.0 : 0.0)) * std::pow(a, 4.0 / 3.0) * kp;
        k = std::max(4.0 / 3.0 * std::pow(a, 1.0 / 3.0) * kp, 0.001 * kp);
        U = 3.0 / 7.0 * std::pow(a, 7.0 / 3.0) * kp;
    } else {
        M = kp * (he - h0);
        k = kp;
        U = 0.5 * kp * (he - h0) * (he - h0);
    }
    M *= s;
    k *= s;
    U *= s;
}

MatX current(const Model& m, const VecX& U) {
    MatX Xc = m.X;
    for (int i = 0; i < Xc.rows(); i++) Xc.row(i) += U.segment<3>(3 * i).transpose();
    return Xc;
}

State initState(const Model& m) {
    State s;
    s.ep = VecX::Zero(m.bars.size());
    s.ab = VecX::Zero(m.bars.size());
    s.thp.resize(m.hinges.size());
    s.ah = VecX::Zero(m.hinges.size());
    s.thRef.resize(m.hinges.size());
    for (size_t i = 0; i < m.hinges.size(); i++) {
        s.thp[i] = m.hinges[i].th0;
        s.thRef[i] = m.hinges[i].th0;
    }
    return s;
}

static int barCMcode(const Options& o) {
    if (o.barCM == "svk" || o.barCM == "linear") return SVK;
    if (o.barCM == "plastic" || std::isfinite(o.barYield)) return LOGPLAS;
    return OGDEN;
}

static inline Vec3 hingeNode(const MatX& Xc, const Hinge& h, int q) {
    if (q == 3 && h.ghostAxis >= 0) {
        Vec3 w = Xc.row(h.n[2]).transpose();
        w[h.ghostAxis] = 2 * h.ghostC - w[h.ghostAxis];
        return w;
    }
    return Xc.row(h.n[q]).transpose();
}

void internal(const Model& m, const VecX& U, const State& st, VecX& IF, SpMat* K, ElemOut* out, bool regularize) {
    const Options& o = m.opt;
    int nd = m.ndof();
    MatX Xc = current(m, U);
    IF = VecX::Zero(nd);
    std::vector<Trip> T;
    if (K) T.reserve(m.bars.size() * 36 + m.hinges.size() * 144 + nd);
    int nb = (int)m.bars.size(), nh = (int)m.hinges.size();
    int cm = barCMcode(o);
    if (out) {
        out->Sx.resize(nb);
        out->Ct.resize(nb);
        out->W.resize(nb);
        out->Ex.resize(nb);
        out->newEp = st.ep;
        out->newAb = st.ab;
        out->dWp = VecX::Zero(nb + nh);
        out->th.resize(nh);
        out->M.resize(nh);
        out->k.resize(nh);
        out->Uh.resize(nh);
        out->newThp = st.thp;
        out->newAh = st.ah;
    }
    for (int e = 0; e < nb; e++) {
        int a = m.bars[e][0], b = m.bars[e][1];
        double L0 = m.L[e], Ae = m.A[e];
        Vec3 X21 = (m.X.row(b) - m.X.row(a)).transpose();
        Vec3 du = U.segment<3>(3 * a) - U.segment<3>(3 * b);
        double Ex = X21.dot(-du) / (L0 * L0) + 0.5 * du.squaredNorm() / (L0 * L0);
        double S, C, W;
        if (cm == LOGPLAS) {
            double lam = std::sqrt(2 * Ex + 1);
            double eps = std::log(lam);
            double etr = eps - st.ep[e];
            double E = o.E;
            double tau = E * etr;
            double f = std::abs(tau) - (o.barYield + o.barH * st.ab[e]);
            double Cb = E, dg = 0;
            if (f > 0) {
                dg = f / (E + o.barH);
                double sg = tau > 0 ? 1.0 : -1.0;
                etr -= dg * sg;
                tau = E * etr;
                Cb = std::max(E * o.barH / (E + o.barH), 1e-3 * E);
            }
            S = tau / (lam * lam);
            C = (Cb - 2 * tau) / (lam * lam * lam * lam);
            W = 0.5 * E * etr * etr;
            if (out) {
                out->newEp[e] = eps - etr;
                out->newAb[e] = st.ab[e] + dg;
                out->dWp[e] = Ae * L0 * std::abs(tau) * dg;
            }
        } else {
            barLaw(cm, o.E, o.ogdenA1, o.ogdenA2, Ex, S, C, W);
        }
        Vec3 d = X21 - du;
        Eigen::Matrix<double, 6, 1> g;
        g << -d / (L0 * L0), d / (L0 * L0);
        IF.segment<3>(3 * a) += Ae * L0 * S * g.head<3>();
        IF.segment<3>(3 * b) += Ae * L0 * S * g.tail<3>();
        if (out) {
            out->Sx[e] = S;
            out->Ct[e] = C;
            out->W[e] = Ae * L0 * W;
            out->Ex[e] = Ex;
        }
        if (K) {
            Eigen::Matrix<double, 6, 6> Ke = Ae * L0 * C * g * g.transpose();
            double kg = Ae * S / L0;
            for (int q = 0; q < 3; q++) {
                Ke(q, q) += kg;
                Ke(3 + q, 3 + q) += kg;
                Ke(q, 3 + q) -= kg;
                Ke(3 + q, q) -= kg;
            }
            int dof[6] = {3 * a, 3 * a + 1, 3 * a + 2, 3 * b, 3 * b + 1, 3 * b + 2};
            for (int r = 0; r < 6; r++)
                for (int c = 0; c < 6; c++) T.emplace_back(dof[r], dof[c], Ke(r, c));
        }
    }
    for (int i = 0; i < nh; i++) {
        const Hinge& h = m.hinges[i];
        Vec3 xj = hingeNode(Xc, h, 0), xk = hingeNode(Xc, h, 1), xi = hingeNode(Xc, h, 2), xl = hingeNode(Xc, h, 3);
        double th = dihedral(xj, xk, xi, xl);
        Eigen::Matrix<double, 12, 1> J;
        dihedralGrad(xj, xk, xi, xl, J);
        double M, kk, Uh;
        if (h.cm == PLASTIC) {
            double s = h.factor * h.L0;
            double Lk0 = h.kp * s, Y = h.Y * s, Hh = h.H * s;
            double Mtr = Lk0 * (th - st.thp[i]);
            double f = std::abs(Mtr) - (Y + Hh * st.ah[i]);
            double the = th - st.thp[i] + h.th0, dg = 0;
            kk = Lk0;
            if (f > 0) {
                dg = f / (Lk0 + Hh);
                the -= dg * (Mtr > 0 ? 1.0 : -1.0);
                kk = std::max(Lk0 * Hh / (Lk0 + Hh), 1e-3 * Lk0);
            }
            M = Lk0 * (the - h.th0);
            Uh = 0.5 * Lk0 * (the - h.th0) * (the - h.th0);
            if (out) {
                out->newThp[i] = th - the + h.th0;
                out->newAh[i] = st.ah[i] + dg;
                out->dWp[nb + i] = std::abs(M) * dg;
            }
        } else {
            hingeLaw(h, th, M, kk, Uh);
        }
        if (out) {
            out->th[i] = th;
            out->M[i] = M;
            out->k[i] = kk;
            out->Uh[i] = Uh;
        }
        Eigen::Matrix<double, 12, 12> Hp, Ke;
        if (K) {
            dihedralHess(xj, xk, xi, xl, J, Hp);
            Ke = kk * J * J.transpose() + M * Hp;
            Ke = 0.5 * (Ke + Ke.transpose()).eval();
        }
        if (h.ghostAxis < 0) {
            for (int q = 0; q < 4; q++) IF.segment<3>(3 * h.n[q]) += M * J.segment<3>(3 * q);
            if (K) {
                int dof[12];
                for (int q = 0; q < 4; q++)
                    for (int c = 0; c < 3; c++) dof[3 * q + c] = 3 * h.n[q] + c;
                for (int r = 0; r < 12; r++)
                    for (int c = 0; c < 12; c++) T.emplace_back(dof[r], dof[c], Ke(r, c));
            }
        } else {
            Eigen::Matrix<double, 12, 9> Tm = Eigen::Matrix<double, 12, 9>::Zero();
            for (int r = 0; r < 9; r++) Tm(r, r) = 1;
            for (int c = 0; c < 3; c++) Tm(9 + c, 6 + c) = (c == h.ghostAxis) ? -1.0 : 1.0;
            Eigen::Matrix<double, 9, 1> J9 = Tm.transpose() * J;
            for (int q = 0; q < 3; q++) IF.segment<3>(3 * h.n[q]) += M * J9.segment<3>(3 * q);
            if (K) {
                Eigen::Matrix<double, 9, 9> K9 = Tm.transpose() * Ke * Tm;
                int dof[9];
                for (int q = 0; q < 3; q++)
                    for (int c = 0; c < 3; c++) dof[3 * q + c] = 3 * h.n[q] + c;
                for (int r = 0; r < 9; r++)
                    for (int c = 0; c < 9; c++) T.emplace_back(dof[r], dof[c], K9(r, c));
            }
        }
    }
    if (K) {
        if (regularize)
            for (int q = 0; q < nd; q++) T.emplace_back(q, q, 1e-8);
        K->resize(nd, nd);
        K->setFromTriplets(T.begin(), T.end());
    }
}

void commitState(const Model& m, State& st, const ElemOut& o) {
    st.ep = o.newEp;
    st.ab = o.newAb;
    st.thp = o.newThp;
    st.ah = o.newAh;
    int nb = (int)m.bars.size();
    st.wpBar += o.dWp.head(nb).sum();
    st.wpHinge += o.dWp.tail(o.dWp.size() - nb).sum();
    st.thRef = o.th;
}

PressureLoad buildPressure(const Model& m, const std::vector<Pressure>& ps) {
    PressureLoad pl;
    for (auto& p : ps) {
        for (int f : p.faces) {
            if (f < 0 || f >= (int)m.panels.size()) continue;
            const auto& P = m.panels[f];
            Vec3 nP = Vec3::Zero();
            for (size_t q = 0; q < P.size(); q++) nP += Vec3(m.X.row(P[q])).cross(Vec3(m.X.row(P[(q + 1) % P.size()])));
            bool fl = std::find(p.flip.begin(), p.flip.end(), f) != p.flip.end();
            if (fl) nP = -nP;
            for (size_t t = 0; t < m.tris.size(); t++) {
                if (m.triPanel[t] != f) continue;
                std::array<int, 3> tr = m.tris[t];
                Vec3 a = m.X.row(tr[0]), b = m.X.row(tr[1]), c = m.X.row(tr[2]);
                Vec3 nt = (b - a).cross(c - a);
                if (nt.dot(nP) < 0) std::swap(tr[1], tr[2]);
                pl.tri.push_back(tr);
                pl.p.push_back(p.p);
                pl.local.push_back(p.local ? 1 : 0);
                pl.dir.push_back(p.dir.norm() > 0 ? Vec3(p.dir.normalized()) : Vec3(0, 0, -1));
                pl.A0.push_back(0.5 * nt.norm());
            }
        }
    }
    return pl;
}

static Eigen::Matrix3d skew(const Vec3& v) {
    Eigen::Matrix3d S;
    S << 0, -v.z(), v.y(), v.z(), 0, -v.x(), -v.y(), v.x(), 0;
    return S;
}

void pressureForce(const Model& m, const PressureLoad& pl, const VecX& U, VecX& f, std::vector<Trip>* Kp) {
    f = VecX::Zero(m.ndof());
    for (size_t t = 0; t < pl.tri.size(); t++) {
        auto& tr = pl.tri[t];
        if (!pl.local[t]) {
            Vec3 F = pl.p[t] * pl.A0[t] / 3.0 * pl.dir[t];
            for (int q = 0; q < 3; q++) f.segment<3>(3 * tr[q]) += F;
            continue;
        }
        Vec3 a = m.X.row(tr[0]).transpose() + U.segment<3>(3 * tr[0]);
        Vec3 b = m.X.row(tr[1]).transpose() + U.segment<3>(3 * tr[1]);
        Vec3 c = m.X.row(tr[2]).transpose() + U.segment<3>(3 * tr[2]);
        double s = pl.p[t] / 6.0;
        Vec3 N = (b - a).cross(c - a);
        for (int q = 0; q < 3; q++) f.segment<3>(3 * tr[q]) += s * N;
        if (Kp) {
            Eigen::Matrix3d dA = s * skew(c - b), dB = s * skew(a - c), dC = s * skew(b - a);
            const Eigen::Matrix3d* D[3] = {&dA, &dB, &dC};
            for (int r = 0; r < 3; r++)
                for (int q = 0; q < 3; q++)
                    for (int i = 0; i < 3; i++)
                        for (int j = 0; j < 3; j++) Kp->emplace_back(3 * tr[r] + i, 3 * tr[q] + j, (*D[q])(i, j));
        }
    }
}

}
