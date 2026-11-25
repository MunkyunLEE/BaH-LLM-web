#include <algorithm>
#include <numeric>
#include <random>
#include <set>
#include <cstdlib>

#include "bh.hpp"

namespace bh {

using Edge = std::pair<int, int>;
static Edge ek(int a, int b) { return a < b ? Edge(a, b) : Edge(b, a); }

static Vec3 rowv(const MatX& X, int i) { return X.row(i).transpose(); }

static Vec3 panelNormal(const MatX& X, const std::vector<int>& f) {
    Vec3 n = Vec3::Zero();
    Vec3 c = Vec3::Zero();
    for (int v : f) c += rowv(X, v);
    c /= (double)f.size();
    for (size_t i = 0; i < f.size(); i++) n += (rowv(X, f[i]) - c).cross(rowv(X, f[(i + 1) % f.size()]) - c);
    double L = n.norm();
    return L > 0 ? Vec3(n / L) : n;
}

static double foldAngleDeg(const MatX& X, const std::vector<int>& f1, const std::vector<int>& f2, Edge e) {
    Vec3 n1 = panelNormal(X, f1), n2 = panelNormal(X, f2);
    auto dirOf = [&](const std::vector<int>& f) {
        auto it = std::find(f.begin(), f.end(), e.first);
        size_t i = it - f.begin();
        return f[(i + 1) % f.size()] == e.second;
    };
    if (dirOf(f1) == dirOf(f2)) n2 = -n2;
    double c = std::max(-1.0, std::min(1.0, n1.dot(n2)));
    return std::acos(c) * 180.0 / PI;
}

static void classify(const Input& in, Model& m) {
    std::map<Edge, std::vector<int>> ef;
    for (size_t fi = 0; fi < in.panels.size(); fi++) {
        const auto& f = in.panels[fi];
        for (size_t i = 0; i < f.size(); i++) ef[ek(f[i], f[(i + 1) % f.size()])].push_back((int)fi);
    }
    std::set<Edge> marked;
    for (auto& l : in.lines) marked.insert(ek(l[0], l[1]));
    double amax = 0;
    for (auto& kv : ef) {
        if (kv.second.size() == 1) {
            m.edgeType[kv.first] = "boundary";
        } else if (kv.second.size() == 2) {
            double a = foldAngleDeg(in.X, in.panels[kv.second[0]], in.panels[kv.second[1]], kv.first);
            m.edgeAngle[kv.first] = a;
            amax = std::max(amax, a);
        } else {
            m.edgeType[kv.first] = "fold";
        }
    }
    if (!marked.empty()) {
        for (auto& kv : m.edgeAngle) m.edgeType[kv.first] = (marked.count(kv.first) || kv.second >= in.tolDeg) ? "fold" : "bend";
        m.note = "lines";
    } else if (!m.edgeAngle.empty() && amax < in.tolDeg) {
        for (auto& kv : m.edgeAngle) m.edgeType[kv.first] = "fold";
        m.note = "flat";
    } else {
        for (auto& kv : m.edgeAngle) m.edgeType[kv.first] = kv.second >= in.tolDeg ? "fold" : "bend";
        m.note = "angle";
    }
    for (auto& kv : in.creases) {
        Edge e = ek(kv.first.first, kv.first.second);
        auto it = m.edgeType.find(e);
        if (it == m.edgeType.end() || it->second == "boundary") continue;
        if (kv.second == "fold" || kv.second == "bend" || kv.second == "cut") it->second = kv.second;
    }
}

static void splitCuts(MatX& X, std::vector<std::vector<int>>& F, std::vector<int>& orig, const std::set<Edge>& cuts) {
    int n0 = (int)X.rows();
    orig.resize(n0);
    std::iota(orig.begin(), orig.end(), 0);
    if (cuts.empty()) return;
    std::vector<std::vector<int>> old = F;
    std::map<int, std::vector<int>> at;
    for (size_t fi = 0; fi < F.size(); fi++)
        for (int v : F[fi]) at[v].push_back((int)fi);
    std::set<int> verts;
    for (auto& e : cuts) {
        verts.insert(e.first);
        verts.insert(e.second);
    }
    std::vector<Vec3> extra;
    for (int v : verts) {
        auto& fs = at[v];
        std::map<int, int> parent;
        for (int f : fs) parent[f] = f;
        std::function<int(int)> find = [&](int a) {
            while (parent[a] != a) a = parent[a] = parent[parent[a]];
            return a;
        };
        std::map<Edge, std::vector<int>> by;
        for (int f : fs) {
            const auto& s = old[f];
            int n = (int)s.size();
            int i = (int)(std::find(s.begin(), s.end(), v) - s.begin());
            for (int w : {s[(i - 1 + n) % n], s[(i + 1) % n]}) by[ek(v, w)].push_back(f);
        }
        for (auto& kv : by) {
            if (cuts.count(kv.first)) continue;
            for (size_t q = 1; q < kv.second.size(); q++) parent[find(kv.second[q])] = find(kv.second[0]);
        }
        std::map<int, std::vector<int>> comps;
        for (int f : fs) comps[find(f)].push_back(f);
        std::vector<std::vector<int>> cl;
        for (auto& kv : comps) cl.push_back(kv.second);
        std::sort(cl.begin(), cl.end(), [](const std::vector<int>& a, const std::vector<int>& b) {
            return *std::min_element(a.begin(), a.end()) < *std::min_element(b.begin(), b.end());
        });
        for (size_t c = 1; c < cl.size(); c++) {
            int nv = n0 + (int)extra.size();
            extra.push_back(rowv(X, v));
            orig.push_back(orig[v]);
            for (int f : cl[c])
                for (int& q : F[f])
                    if (q == v) q = nv;
        }
    }
    if (!extra.empty()) {
        MatX Y(n0 + extra.size(), 3);
        Y.topRows(n0) = X;
        for (size_t i = 0; i < extra.size(); i++) Y.row(n0 + i) = extra[i].transpose();
        X = Y;
    }
}

static Vec3 optCenter(const MatX& P) {
    int n = (int)P.rows();
    std::vector<std::pair<int, int>> IJ;
    for (int j = 0; j < n; j++)
        for (int i = 0; i < j - 1; i++)
            if (!(i == 0 && j == n - 1)) IJ.push_back({i, j});
    auto obj = [&](const Vec3& X) {
        double s = 0;
        for (auto& p : IJ) {
            Vec3 a = rowv(P, p.second) - X, b = rowv(P, p.first) - X;
            double L2 = (rowv(P, p.second) - rowv(P, p.first)).squaredNorm();
            s += a.cross(b).norm() / L2;
        }
        return s;
    };
    auto grad = [&](const Vec3& X) {
        Vec3 g = Vec3::Zero();
        double h = 1e-7;
        for (int d = 0; d < 3; d++) {
            Vec3 a = X, b = X;
            a[d] += h;
            b[d] -= h;
            g[d] = (obj(a) - obj(b)) / (2 * h);
        }
        return g;
    };
    auto run = [&](Vec3 X) {
        Eigen::Matrix3d Hi = Eigen::Matrix3d::Identity();
        Vec3 g = grad(X);
        for (int it = 0; it < 500 && g.norm() > 1e-12; it++) {
            Vec3 d = -Hi * g;
            double a = 1, f0 = obj(X);
            while (obj(X + a * d) > f0 + 1e-4 * a * g.dot(d) && a > 1e-12) a *= 0.5;
            Vec3 s = a * d, Xn = X + s, gn = grad(Xn), y = gn - g;
            double sy = s.dot(y);
            if (sy > 1e-16) {
                Eigen::Matrix3d I = Eigen::Matrix3d::Identity();
                Hi = (I - s * y.transpose() / sy) * Hi * (I - y * s.transpose() / sy) + s * s.transpose() / sy;
            }
            X = Xn;
            g = gn;
            if (s.norm() < 1e-14) break;
        }
        return std::make_pair(X, obj(X));
    };
    double best = INF;
    int idmin = 0;
    for (size_t q = 0; q < IJ.size(); q++) {
        double L2 = (rowv(P, IJ[q].second) - rowv(P, IJ[q].first)).squaredNorm();
        if (L2 < best) {
            best = L2;
            idmin = (int)q;
        }
    }
    Vec3 x01 = (rowv(P, IJ[idmin].first) + rowv(P, IJ[idmin].second)) / 2;
    Vec3 x02 = P.colwise().mean().transpose();
    auto r1 = run(x01), r2 = run(x02);
    return r1.second <= r2.second ? r1.first : r2.first;
}

static std::vector<std::array<int, 2>> dividePolygon(const MatX& P) {
    std::vector<std::array<int, 2>> out;
    int n = (int)P.rows();
    if (n <= 3) return out;
    double best = INF;
    int bi = 0, bj = 0;
    for (int j = 0; j < n; j++)
        for (int i = 0; i < j - 1; i++) {
            if (i == 0 && j == n - 1) continue;
            double L2 = (rowv(P, j) - rowv(P, i)).squaredNorm();
            if (L2 < best) {
                best = L2;
                bi = i;
                bj = j;
            }
        }
    out.push_back({bi, bj});
    std::vector<int> T1, T2;
    for (int i = 0; i <= bi; i++) T1.push_back(i);
    for (int i = bj; i < n; i++) T1.push_back(i);
    for (int i = bi; i <= bj; i++) T2.push_back(i);
    for (auto* T : {&T1, &T2}) {
        MatX Q(T->size(), 3);
        for (size_t q = 0; q < T->size(); q++) Q.row(q) = P.row((*T)[q]);
        for (auto& e : dividePolygon(Q)) out.push_back({(*T)[e[0]], (*T)[e[1]]});
    }
    return out;
}

struct Disc {
    std::vector<std::array<int, 4>> bend, fold;
    std::vector<std::array<int, 2>> bdry;
    std::vector<std::array<int, 3>> trigl;
    std::vector<int> panelctr;
};

static void findbend(MatX& X, const std::vector<std::vector<int>>& P, bool n5b8, Disc& d) {
    int Nn = (int)X.rows();
    d.panelctr.assign(P.size(), -1);
    std::vector<Vec3> extra;
    for (size_t i = 0; i < P.size(); i++) {
        const auto& f = P[i];
        int nf = (int)f.size();
        if (!n5b8) {
            if (nf == 4) {
                double L1 = (rowv(X, f[0]) - rowv(X, f[2])).norm();
                double L2 = (rowv(X, f[3]) - rowv(X, f[1])).norm();
                if (L1 > L2)
                    d.bend.push_back({f[1], f[3], f[0], f[2]});
                else
                    d.bend.push_back({f[0], f[2], f[1], f[3]});
            } else if (nf > 4) {
                MatX Q(nf, 3);
                for (int q = 0; q < nf; q++) Q.row(q) = X.row(f[q]);
                auto bi = dividePolygon(Q);
                std::vector<std::array<int, 2>> links;
                for (int q = 0; q < nf; q++) links.push_back({(q - 1 + nf) % nf, q});
                for (auto& e : bi) links.push_back(e);
                for (auto& e : bi) {
                    std::vector<int> ab;
                    for (int q = 0; q < nf; q++) {
                        if (q == e[0] || q == e[1]) continue;
                        int c0 = 0, c1 = 0;
                        for (auto& l : links) {
                            if ((l[0] == q && l[1] == e[0]) || (l[1] == q && l[0] == e[0])) c0 = 1;
                            if ((l[0] == q && l[1] == e[1]) || (l[1] == q && l[0] == e[1])) c1 = 1;
                        }
                        if (c0 && c1) ab.push_back(q);
                    }
                    if (ab.size() != 2) std::abort();
                    d.bend.push_back({f[e[0]], f[e[1]], f[ab[0]], f[ab[1]]});
                }
            }
        } else {
            if (nf == 4) {
                Vec3 p1 = rowv(X, f[0]), p2 = rowv(X, f[1]), p3 = rowv(X, f[2]), p4 = rowv(X, f[3]);
                double L1 = (p1 - p3).norm(), L2 = (p4 - p2).norm();
                Vec3 mm = (p3 - p1) / L1, nn = (p4 - p2) / L2;
                Eigen::Matrix<double, 3, 2> Am;
                Am.col(0) = mm;
                Am.col(1) = -nn;
                Eigen::Vector2d coeff = Am.colPivHouseholderQr().solve(p2 - p1);
                Vec3 c = L1 < L2 ? Vec3(p1 + coeff(0) * mm) : Vec3(p2 + coeff(1) * nn);
                extra.push_back(c);
            } else if (nf > 4) {
                MatX Q(nf, 3);
                for (int q = 0; q < nf; q++) Q.row(q) = X.row(f[q]);
                extra.push_back(optCenter(Q));
            } else {
                continue;
            }
            int c = Nn + (int)extra.size() - 1;
            d.panelctr[i] = c;
            for (int k = 0; k < nf; k++) d.bend.push_back({c, f[k], f[(k - 1 + nf) % nf], f[(k + 1) % nf]});
        }
    }
    if (!extra.empty()) {
        MatX Y(Nn + extra.size(), 3);
        Y.topRows(Nn) = X;
        for (size_t i = 0; i < extra.size(); i++) Y.row(Nn + i) = extra[i].transpose();
        X = Y;
    }
}

static void findfdbd(const std::vector<std::vector<int>>& P, Disc& d) {
    std::vector<std::array<int, 3>> raw;
    for (auto& b : d.bend) raw.push_back({b[0], b[1], b[2]});
    for (auto& b : d.bend) raw.push_back({b[0], b[1], b[3]});
    for (auto& f : P)
        if (f.size() == 3) raw.push_back({f[0], f[1], f[2]});
    for (auto& r : raw) std::sort(r.begin(), r.end());
    std::sort(raw.begin(), raw.end());
    raw.erase(std::unique(raw.begin(), raw.end()), raw.end());
    d.trigl = raw;
    int nt = (int)raw.size();
    std::map<Edge, std::vector<int>> et;
    for (int t = 0; t < nt; t++) {
        auto& r = raw[t];
        et[ek(r[0], r[1])].push_back(t);
        et[ek(r[1], r[2])].push_back(t);
        et[ek(r[0], r[2])].push_back(t);
    }
    std::vector<std::array<int, 2>> pairs;
    for (auto& kv : et) {
        auto& v = kv.second;
        for (size_t a = 0; a < v.size(); a++)
            for (size_t b = a + 1; b < v.size(); b++) {
                int mf = std::min(v[a], v[b]), me = std::max(v[a], v[b]);
                pairs.push_back({me, mf});
            }
    }
    std::sort(pairs.begin(), pairs.end());
    std::set<Edge> bendAxis;
    for (auto& b : d.bend) bendAxis.insert(ek(b[0], b[1]));
    for (auto& pr : pairs) {
        int me = pr[0], mf = pr[1];
        auto& A = raw[mf];
        auto& B = raw[me];
        std::vector<int> link;
        for (int x : A)
            if (std::find(B.begin(), B.end(), x) != B.end()) link.push_back(x);
        if (link.size() != 2) continue;
        if (bendAxis.count(ek(link[0], link[1]))) continue;
        int oa = -1, ob = -1;
        for (int x : A)
            if (x != link[0] && x != link[1]) oa = x;
        for (int x : B)
            if (x != link[0] && x != link[1]) ob = x;
        d.fold.push_back({link[0], link[1], oa, ob});
    }
    std::vector<std::array<int, 2>> edges;
    for (auto& r : raw) edges.push_back({std::min(r[0], r[1]), std::max(r[0], r[1])});
    for (auto& r : raw) edges.push_back({std::min(r[1], r[2]), std::max(r[1], r[2])});
    for (auto& r : raw) edges.push_back({std::min(r[2], r[0]), std::max(r[2], r[0])});
    std::sort(edges.begin(), edges.end());
    for (size_t i = 0; i < edges.size();) {
        size_t j = i;
        while (j < edges.size() && edges[j] == edges[i]) j++;
        if (j - i == 1) d.bdry.push_back(edges[i]);
        i = j;
    }
}

static double triArea(const MatX& X, int a, int b, int c) {
    return 0.5 * (rowv(X, b) - rowv(X, a)).cross(rowv(X, c) - rowv(X, a)).norm();
}

Model build(const Input& in) {
    Model m;
    m.opt = in.opt;
    const Options& o = m.opt;
    for (auto& f : in.panels)
        if (f.size() < 3) std::abort();
    classify(in, m);
    std::set<Edge> cuts;
    for (auto& kv : m.edgeType)
        if (kv.second == "cut") cuts.insert(kv.first);
    MatX X = in.X;
    if (o.imperfection > 0) {
        std::mt19937 gen(o.imperfectionSeed);
        std::uniform_real_distribution<double> U(-1.0, 1.0);
        int n0 = (int)X.rows();
        std::vector<Vec3> nrm(n0, Vec3::Zero());
        for (auto& f : in.panels) {
            Vec3 nv = panelNormal(in.X, f);
            for (int x : f) nrm[x] += nv;
        }
        for (int i = 0; i < n0; i++) {
            double r = U(gen), L = nrm[i].norm();
            if (L > 0) X.row(i) += (o.imperfection * r * nrm[i] / L).transpose();
        }
    }
    std::vector<std::vector<int>> F = in.panels;
    splitCuts(X, F, m.orig, cuts);
    m.nInput = (int)in.X.rows();
    bool n5b8 = o.model != "N4B5";
    Disc d;
    findbend(X, F, n5b8, d);
    findfdbd(F, d);
    m.X = X;
    m.panels = F;
    m.panelCtr = d.panelctr;
    m.tris = d.trigl;
    int nb = (int)d.bend.size(), nf = (int)d.fold.size(), nr = (int)d.bdry.size();
    m.nBend = nb;
    m.nFold = nf;
    m.nBdry = nr;
    for (auto& b : d.bend) m.bars.push_back({b[0], b[1]});
    for (auto& b : d.fold) m.bars.push_back({b[0], b[1]});
    for (auto& b : d.bdry) m.bars.push_back(b);
    int nbar = (int)m.bars.size();
    m.barKind.resize(nbar);
    for (int i = 0; i < nbar; i++) m.barKind[i] = i < nb ? 0 : (i < nb + nf ? 1 : 2);
    m.L.resize(nbar);
    for (int i = 0; i < nbar; i++) m.L[i] = (rowv(X, m.bars[i][1]) - rowv(X, m.bars[i][0])).norm();

    auto origEdgeType = [&](int a, int b) {
        Edge e = ek(m.orig[a], m.orig[b]);
        auto it = m.edgeType.find(e);
        return it == m.edgeType.end() ? std::string("fold") : it->second;
    };

    double E = o.E, nu = o.nu, t = o.t;
    double G = E * t * t * t / (12 * (1 - nu * nu));
    m.G = G;
    VecX A = VecX::Zero(nbar);
    VecX kpb = VecX::Zero(nb), kpf = VecX::Zero(nf);
    bool manual = o.calib == "manual" || !n5b8;
    std::map<Edge, int> foldIdx, bendIdx, bdryIdx;
    for (int i = 0; i < nf; i++) foldIdx[ek(d.fold[i][0], d.fold[i][1])] = i;
    for (int i = 0; i < nb; i++) bendIdx[ek(d.bend[i][0], d.bend[i][1])] = i;
    for (int i = 0; i < nr; i++) bdryIdx[ek(d.bdry[i][0], d.bdry[i][1])] = i;
    if (manual) {
        A.setConstant(o.Abar);
        kpb.setConstant(o.Kb);
        kpf.setConstant(o.Kf > 0 ? o.Kf : 0.1 * o.Kb);
    } else {
        for (int i = 0; i < nf; i++) {
            double Lf = m.L[nb + i];
            double Kl;
            if (o.Lstar > 0)
                Kl = G * Lf / o.Lstar;
            else
                Kl = G / (o.Lratio > 0 ? o.Lratio : 3.0);
            double Km = 0.55 * G * std::pow(Lf / t, 1.0 / 3.0);
            kpf[i] = (1.0 / (1.0 / Kl + 1.0 / Km)) / Lf;
        }
        auto barOf = [&](int a, int b) -> int {
            Edge e = ek(a, b);
            auto f = foldIdx.find(e);
            if (f != foldIdx.end()) return nb + f->second;
            auto r = bdryIdx.find(e);
            if (r != bdryIdx.end()) return nb + nf + r->second;
            return -1;
        };
        std::map<Edge, double> triBarA;
        for (size_t j = 0; j < F.size(); j++) {
            const auto& L = F[j];
            int n = (int)L.size();
            std::vector<double> Lf(n);
            for (int q = 0; q < n; q++) Lf[q] = (rowv(X, L[(q + 1) % n]) - rowv(X, L[q])).norm();
            if (n == 3) {
                double S = triArea(X, L[0], L[1], L[2]);
                double per = Lf[0] + Lf[1] + Lf[2];
                for (int q = 0; q < 3; q++) {
                    double Aq;
                    if (o.triBars == "woodruff" || o.triBars == "khawale") {
                        Aq = S * t / Lf[q];
                        if (o.triBars == "woodruff") {
                            int jd = (int)(std::max_element(Lf.begin(), Lf.end()) - Lf.begin());
                            if (q == jd) {
                                double s1 = Lf[(jd + 1) % 3], s2 = Lf[(jd + 2) % 3];
                                double ar = std::max(s1, s2) / std::max(std::min(s1, s2), 1e-300);
                                Aq *= ar * ar / 2 + 1.25;
                            }
                        } else {
                            Aq *= o.Fs;
                        }
                    } else {
                        Aq = t * 2 * S / (per * (1 - nu));
                    }
                    int bi = barOf(L[q], L[(q + 1) % 3]);
                    if (bi >= 0) A[bi] += Aq;
                }
            } else if (n == 4) {
                int c = d.panelctr[j];
                std::vector<double> Lb(4), kb(4);
                for (int q = 0; q < 4; q++) Lb[q] = (rowv(X, L[q]) - rowv(X, c)).norm();
                for (int q = 0; q < 4; q++) {
                    double Dsl = Lb[q] + Lb[(q + 2) % 4];
                    kb[q] = G * std::pow(Dsl / t, 1.0 / 3.0) / Dsl;
                }
                std::vector<int> spokeIdx(4);
                for (int q = 0; q < 4; q++) spokeIdx[q] = bendIdx.at(ek(L[q], c));
                if (o.compat) {
                    std::vector<int> ordr(4);
                    std::iota(ordr.begin(), ordr.end(), 0);
                    std::sort(ordr.begin(), ordr.end(), [&](int a, int b) { return L[a] < L[b]; });
                    for (int r = 0; r < 4; r++) kpb[spokeIdx[ordr[r]]] += kb[r];
                } else {
                    for (int q = 0; q < 4; q++) kpb[spokeIdx[q]] += kb[q];
                }
                double W = (Lf[0] + Lf[2]) / 2, H = (Lf[1] + Lf[3]) / 2;
                double Af[4];
                Af[0] = Af[2] = t * std::abs(H * H - nu * W * W) / (2 * H * (1 - nu * nu));
                Af[1] = Af[3] = t * std::abs(W * W - nu * H * H) / (2 * W * (1 - nu * nu));
                double Ab = t * nu * std::pow(H * H + W * W, 1.5) / (2 * H * W * (1 - nu * nu));
                for (int q = 0; q < 4; q++) A[spokeIdx[q]] += Ab;
                int nfold = 0;
                for (int q = 0; q < 4; q++)
                    if (foldIdx.count(ek(L[q], L[(q + 1) % 4]))) nfold++;
                if (o.compat && nfold == 4) {
                    std::vector<int> ordr(4);
                    std::iota(ordr.begin(), ordr.end(), 0);
                    std::sort(ordr.begin(), ordr.end(), [&](int a, int b) { return ek(L[a], L[(a + 1) % 4]) < ek(L[b], L[(b + 1) % 4]); });
                    for (int r = 0; r < 4; r++) {
                        int q = ordr[r];
                        A[barOf(L[q], L[(q + 1) % 4])] += Af[r];
                    }
                } else {
                    for (int q = 0; q < 4; q++) {
                        int bi = barOf(L[q], L[(q + 1) % 4]);
                        if (bi >= 0) A[bi] += Af[q];
                    }
                }
            } else {
                int c = d.panelctr[j];
                std::vector<Vec3> Sa(n);
                std::vector<double> Lb(n);
                double S = 0, sumLb = 0, sumLf = 0;
                for (int q = 0; q < n; q++) {
                    Sa[q] = rowv(X, L[q]) - rowv(X, c);
                    Lb[q] = Sa[q].norm();
                    sumLb += Lb[q];
                    sumLf += Lf[q];
                }
                for (int q = 0; q < n; q++) S += 0.5 * Sa[q].cross(rowv(X, L[(q + 1) % n]) - rowv(X, c)).norm();
                double Ap = t * 2 * S / ((sumLf + sumLb) * (1 - nu));
                std::vector<int> spokeIdx(n);
                for (int q = 0; q < n; q++) {
                    spokeIdx[q] = bendIdx.at(ek(L[q], c));
                    A[spokeIdx[q]] += Ap;
                    int bi = barOf(L[q], L[(q + 1) % n]);
                    if (bi >= 0) A[bi] += Ap;
                }
                for (int q = 0; q < n; q++) {
                    int id = 0;
                    double best = INF;
                    for (int r = 0; r < n; r++) {
                        double dd = (Sa[r] / Lb[r]).dot(Sa[q] / Lb[q]);
                        if (dd < best) {
                            best = dd;
                            id = r;
                        }
                    }
                    double Dsl = Lb[q] + Lb[id];
                    kpb[spokeIdx[q]] += G * std::pow(Dsl / t, 1.0 / 3.0) / Dsl;
                }
            }
        }
    }
    m.A = A;

    int foldCM = o.foldCM == "linear" ? LINEAR : (o.foldCM == "plastic" ? PLASTIC : ENHANCED);
    int bendCM;
    if (o.bendCM.empty())
        bendCM = manual ? ENHANCED : SUPERLINEAR;
    else
        bendCM = o.bendCM == "linear" ? LINEAR : (o.bendCM == "plastic" ? PLASTIC : (o.bendCM == "superlinear" ? SUPERLINEAR : ENHANCED));
    int edgeCM = o.edgeBendCM == "plastic" ? PLASTIC : (o.edgeBendCM == "superlinear" ? SUPERLINEAR : (o.edgeBendCM == "enhanced" ? ENHANCED : LINEAR));
    for (int i = 0; i < nb; i++) {
        Hinge h;
        h.n = d.bend[i];
        h.kind = PANEL_BEND;
        h.cm = bendCM;
        h.kp = kpb[i] * o.bendScale;
        h.L0 = m.L[i];
        h.bar = i;
        h.th1 = o.bendTh1 * PI / 180;
        h.th2 = o.bendTh2 * PI / 180;
        h.Y = o.bendYield;
        h.H = o.bendH;
        if (o.zeroBend == "flat")
            h.th0 = PI;
        else if (o.zeroBend == "value")
            h.th0 = o.zeroBendValue;
        else
            h.th0 = dihedral(rowv(X, h.n[0]), rowv(X, h.n[1]), rowv(X, h.n[2]), rowv(X, h.n[3]));
        m.hinges.push_back(h);
    }
    for (int i = 0; i < nf; i++) {
        Hinge h;
        h.n = d.fold[i];
        h.L0 = m.L[nb + i];
        h.bar = nb + i;
        h.edge = {m.orig[h.n[0]], m.orig[h.n[1]]};
        h.th0 = dihedral(rowv(X, h.n[0]), rowv(X, h.n[1]), rowv(X, h.n[2]), rowv(X, h.n[3]));
        std::string ty = origEdgeType(h.n[0], h.n[1]);
        if (ty == "bend") {
            h.kind = EDGE_BEND;
            h.cm = edgeCM;
            double A1 = triArea(X, h.n[0], h.n[1], h.n[2]), A2 = triArea(X, h.n[0], h.n[1], h.n[3]);
            double Lb = h.L0, kB;
            if (o.edgeBend == "khawale")
                kB = o.FB * E * Lb * Lb * t * t * t / (48 * (A1 + A2));
            else
                kB = 2 * G * Lb * Lb / (A1 + A2);
            h.kp = kB / Lb * o.bendScale;
            h.th1 = o.bendTh1 * PI / 180;
            h.th2 = o.bendTh2 * PI / 180;
            h.Y = o.bendYield;
            h.H = o.bendH;
        } else {
            h.kind = FOLD;
            h.cm = foldCM;
            h.kp = kpf[i] * o.foldScale;
            h.th1 = o.foldTh1 * PI / 180;
            h.th2 = o.foldTh2 * PI / 180;
            h.Y = o.foldYield;
            h.H = o.foldH;
        }
        m.hinges.push_back(h);
    }

    for (auto& s : in.sym) {
        Vec3 nrm = Vec3::Zero();
        nrm[s.axis] = 1;
        for (auto& sb : s.bars) {
            for (int bi = nb + nf; bi < nbar; bi++) {
                int a = m.bars[bi][0], b = m.bars[bi][1];
                if (ek(m.orig[a], m.orig[b]) != ek(sb[0], sb[1])) continue;
                int w = -1;
                for (auto& tr : m.tris) {
                    bool ha = std::find(tr.begin(), tr.end(), a) != tr.end();
                    bool hb = std::find(tr.begin(), tr.end(), b) != tr.end();
                    if (ha && hb)
                        for (int x : tr)
                            if (x != a && x != b) w = x;
                }
                if (w < 0) continue;
                Hinge h;
                h.n = {a, b, w, w};
                h.ghostAxis = s.axis;
                h.ghostC = s.c;
                h.L0 = m.L[bi];
                h.bar = bi;
                h.factor = 0.5;
                h.edge = {m.orig[a], m.orig[b]};
                Vec3 xw = rowv(X, w), xg = xw - 2 * (xw[s.axis] - s.c) * nrm;
                h.th0 = dihedral(rowv(X, a), rowv(X, b), xw, xg);
                std::string ty = "fold";
                auto it = in.creases.find(ek(sb[0], sb[1]));
                if (it != in.creases.end()) ty = it->second;
                double Lf = h.L0;
                if (ty == "bend") {
                    h.kind = EDGE_BEND;
                    h.cm = edgeCM;
                    double A1 = triArea(X, a, b, w);
                    double kB = o.edgeBend == "khawale" ? o.FB * E * Lf * Lf * t * t * t / (48 * 2 * A1) : 2 * G * Lf * Lf / (2 * A1);
                    h.kp = kB / Lf * o.bendScale;
                    h.th1 = o.bendTh1 * PI / 180;
                    h.th2 = o.bendTh2 * PI / 180;
                    h.Y = o.bendYield;
                    h.H = o.bendH;
                } else {
                    h.kind = FOLD;
                    h.cm = foldCM;
                    if (manual)
                        h.kp = (o.Kf > 0 ? o.Kf : 0.1 * o.Kb);
                    else {
                        double Kl = o.Lstar > 0 ? G * Lf / o.Lstar : G / (o.Lratio > 0 ? o.Lratio : 3.0);
                        double Km = 0.55 * G * std::pow(Lf / t, 1.0 / 3.0);
                        h.kp = (1.0 / (1.0 / Kl + 1.0 / Km)) / Lf;
                    }
                    h.kp *= o.foldScale;
                    h.th1 = o.foldTh1 * PI / 180;
                    h.th2 = o.foldTh2 * PI / 180;
                    h.Y = o.foldYield;
                    h.H = o.foldH;
                }
                m.hinges.push_back(h);
                for (int v : {a, b}) m.fixedDofs.push_back(3 * v + s.axis);
            }
        }
    }

    int nn = (int)X.rows();
    m.mass = VecX::Zero(nn);
    if (o.rho > 0) {
        for (size_t j = 0; j < F.size(); j++) {
            const auto& L = F[j];
            double S = 0;
            Vec3 c0 = rowv(X, L[0]);
            for (size_t q = 1; q + 1 < L.size(); q++) S += triArea(X, L[0], L[q], L[q + 1]);
            (void)c0;
            int c = d.panelctr[j];
            int cnt = (int)L.size() + (c >= 0 ? 1 : 0);
            double mm = o.rho * t * S / cnt;
            for (int v : L) m.mass[v] += mm;
            if (c >= 0) m.mass[c] += mm;
        }
    }
    for (auto& tr : m.tris) {
        int p = -1;
        for (size_t j = 0; j < F.size() && p < 0; j++) {
            const auto& L = F[j];
            int cnt = 0;
            for (int x : tr)
                if (std::find(L.begin(), L.end(), x) != L.end() || x == d.panelctr[j]) cnt++;
            if (cnt == 3) p = (int)j;
        }
        m.triPanel.push_back(p);
    }
    std::sort(m.fixedDofs.begin(), m.fixedDofs.end());
    m.fixedDofs.erase(std::unique(m.fixedDofs.begin(), m.fixedDofs.end()), m.fixedDofs.end());
    return m;
}

std::vector<int> fixedFromSupp(const Model& m, const std::vector<std::array<int, 4>>& supp, int) {
    std::vector<int> out = m.fixedDofs;
    for (auto& s : supp)
        for (int i = 0; i < (int)m.orig.size(); i++)
            if (m.orig[i] == s[0])
                for (int d = 0; d < 3; d++)
                    if (s[1 + d]) out.push_back(3 * i + d);
    std::sort(out.begin(), out.end());
    out.erase(std::unique(out.begin(), out.end()), out.end());
    return out;
}

}
