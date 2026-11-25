#include "contact.hpp"

#include <algorithm>
#include <set>

namespace bh {

namespace {

struct D2 {
    double v;
    Eigen::Matrix<double, 12, 1> g;
    Eigen::Matrix<double, 12, 12> h;
};

D2 cst(double v) {
    D2 r;
    r.v = v;
    r.g.setZero();
    r.h.setZero();
    return r;
}
D2 var(double v, int i) {
    D2 r = cst(v);
    r.g[i] = 1;
    return r;
}
D2 operator+(const D2& a, const D2& b) { return {a.v + b.v, a.g + b.g, a.h + b.h}; }
D2 operator-(const D2& a, const D2& b) { return {a.v - b.v, a.g - b.g, a.h - b.h}; }
D2 operator*(const D2& a, const D2& b) {
    return {a.v * b.v, a.v * b.g + b.v * a.g, a.v * b.h + b.v * a.h + a.g * b.g.transpose() + b.g * a.g.transpose()};
}
D2 operator/(const D2& a, const D2& b) {
    double iv = 1.0 / b.v;
    D2 r;
    r.v = a.v * iv;
    r.g = (a.g - r.v * b.g) * iv;
    r.h = (a.h - r.g * b.g.transpose() - b.g * r.g.transpose() - r.v * b.h) * iv;
    return r;
}

struct V3 {
    D2 x, y, z;
};
V3 sub(const V3& a, const V3& b) { return {a.x - b.x, a.y - b.y, a.z - b.z}; }
V3 crs(const V3& a, const V3& b) { return {a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x}; }
D2 dot(const V3& a, const V3& b) { return a.x * b.x + a.y * b.y + a.z * b.z; }

V3 seed(const Vec3& p, int slot) { return {var(p.x(), 3 * slot), var(p.y(), 3 * slot + 1), var(p.z(), 3 * slot + 2)}; }

double segParam(const Vec3& p, const Vec3& a, const Vec3& b) {
    Vec3 e = b - a;
    double L2 = e.squaredNorm();
    return L2 > 0 ? (p - a).dot(e) / L2 : 0.0;
}

D2 d2PP(const V3& p, const V3& q) {
    V3 d = sub(p, q);
    return dot(d, d);
}
D2 d2PE(const V3& p, const V3& a, const V3& b) {
    V3 e = sub(b, a);
    V3 c = crs(sub(p, a), e);
    return dot(c, c) / dot(e, e);
}
D2 d2PL(const V3& p, const V3& a, const V3& b, const V3& c) {
    V3 n = crs(sub(b, a), sub(c, a));
    D2 s = dot(sub(p, a), n);
    return s * s / dot(n, n);
}
D2 d2LL(const V3& a, const V3& b, const V3& c, const V3& d) {
    V3 n = crs(sub(b, a), sub(d, c));
    D2 s = dot(sub(c, a), n);
    return s * s / dot(n, n);
}

double ptDist2(const Vec3& p, const Vec3& a, const Vec3& b, const Vec3& c, int& type) {
    Vec3 n = (b - a).cross(c - a);
    double nn = n.squaredNorm();
    Vec3 q = p - n * ((p - a).dot(n) / nn);
    Vec3 e0 = b - a, e1 = c - b, e2 = a - c;
    double s0 = e0.cross(q - a).dot(n), s1 = e1.cross(q - b).dot(n), s2 = e2.cross(q - c).dot(n);
    if (s0 >= 0 && s1 >= 0 && s2 >= 0) {
        type = 6;
        double s = (p - a).dot(n);
        return s * s / nn;
    }
    double best = INF;
    const Vec3* V[3] = {&a, &b, &c};
    for (int k = 0; k < 3; k++) {
        const Vec3& u = *V[k];
        const Vec3& w = *V[(k + 1) % 3];
        double t = segParam(p, u, w);
        double dd;
        int ty;
        if (t <= 0) {
            dd = (p - u).squaredNorm();
            ty = k;
        } else if (t >= 1) {
            dd = (p - w).squaredNorm();
            ty = (k + 1) % 3;
        } else {
            dd = (p - u).cross(w - u).squaredNorm() / (w - u).squaredNorm();
            ty = 3 + k;
        }
        if (dd < best) {
            best = dd;
            type = ty;
        }
    }
    return best;
}

double eeDist2(const Vec3& a, const Vec3& b, const Vec3& c, const Vec3& d, int& type) {
    Vec3 u = b - a, v = d - c, w = a - c;
    double A = u.dot(u), B = u.dot(v), C = v.dot(v), D = u.dot(w), E = v.dot(w);
    double den = A * C - B * B;
    double par = den / std::max(A * C, 1e-300);
    if (par > 1e-6) {
        double s = (B * E - C * D) / den, t = (A * E - B * D) / den;
        if (s > 0 && s < 1 && t > 0 && t < 1) {
            type = 8;
            Vec3 n = u.cross(v);
            double q = (c - a).dot(n);
            return q * q / n.squaredNorm();
        }
    }
    double best = INF;
    auto pe = [&](const Vec3& p, const Vec3& x, const Vec3& y, int tPP0, int tPP1, int tPE) {
        double t = segParam(p, x, y);
        double dd;
        int ty;
        if (t <= 0) {
            dd = (p - x).squaredNorm();
            ty = tPP0;
        } else if (t >= 1) {
            dd = (p - y).squaredNorm();
            ty = tPP1;
        } else {
            dd = (p - x).cross(y - x).squaredNorm() / (y - x).squaredNorm();
            ty = tPE;
        }
        if (dd < best) {
            best = dd;
            type = ty;
        }
    };
    pe(a, c, d, 0, 1, 4);
    pe(b, c, d, 2, 3, 5);
    pe(c, a, b, 0, 2, 6);
    pe(d, a, b, 1, 3, 7);
    return best;
}

D2 ptD2(const Vec3& p, const Vec3& a, const Vec3& b, const Vec3& c, int type) {
    V3 P = seed(p, 0), A = seed(a, 1), B = seed(b, 2), C = seed(c, 3);
    switch (type) {
        case 0: return d2PP(P, A);
        case 1: return d2PP(P, B);
        case 2: return d2PP(P, C);
        case 3: return d2PE(P, A, B);
        case 4: return d2PE(P, B, C);
        case 5: return d2PE(P, C, A);
        default: return d2PL(P, A, B, C);
    }
}

D2 eeD2(const Vec3& a, const Vec3& b, const Vec3& c, const Vec3& d, int type) {
    V3 A = seed(a, 0), B = seed(b, 1), C = seed(c, 2), D = seed(d, 3);
    switch (type) {
        case 0: return d2PP(A, C);
        case 1: return d2PP(A, D);
        case 2: return d2PP(B, C);
        case 3: return d2PP(B, D);
        case 4: return d2PE(A, C, D);
        case 5: return d2PE(B, C, D);
        case 6: return d2PE(C, A, B);
        case 7: return d2PE(D, A, B);
        default: return d2LL(A, B, C, D);
    }
}

void barrier(double s, double dh, double& b, double& b1, double& b2) {
    double r = s - dh, l = std::log(s / dh);
    b = -r * r * l;
    b1 = -2 * r * l - r * r / s;
    b2 = -2 * l - 4 * r / s + r * r / (s * s);
}

template <int N>
Eigen::Matrix<double, N, N> psd(const Eigen::Matrix<double, N, N>& H) {
    Eigen::SelfAdjointEigenSolver<Eigen::Matrix<double, N, N>> es(H);
    Eigen::Matrix<double, N, 1> l = es.eigenvalues().cwiseMax(0.0);
    return es.eigenvectors() * l.asDiagonal() * es.eigenvectors().transpose();
}

Vec3 row(const MatX& X, int i) { return X.row(i).transpose(); }

}

void Contact::init(const Model& m, double gap, double kappaIn, const std::vector<Symmetry>& sym) {
    double Lbar = m.L.mean();
    dmin = gap > 0 ? gap : 1e-3 * Lbar;
    dhat = dmin;
    std::vector<double> ks;
    for (auto& h : m.hinges) ks.push_back(h.kp * h.L0);
    std::sort(ks.begin(), ks.end());
    double k = ks.empty() ? (m.A.mean() * m.opt.E / Lbar) * Lbar * Lbar : ks[ks.size() / 2];
    kappa = kappaIn > 0 ? kappaIn : 1e3 * k / (Lbar * Lbar);
    tris = m.tris;
    std::set<std::pair<int, int>> es;
    for (auto& t : tris)
        for (int q = 0; q < 3; q++) {
            int a = t[q], b = t[(q + 1) % 3];
            es.insert({std::min(a, b), std::max(a, b)});
        }
    for (auto& e : es) edges.push_back({e.first, e.second});
    std::set<int> vs;
    for (auto& t : tris)
        for (int v : t) vs.insert(v);
    verts.assign(vs.begin(), vs.end());
    auto same = [&](int a, int b) {
        if (a == b) return true;
        if (a < (int)m.orig.size() && b < (int)m.orig.size()) return m.orig[a] == m.orig[b];
        return false;
    };
    const MatX& X = m.X;
    double lim = dmin + dhat;
    for (size_t t = 0; t < tris.size(); t++)
        for (int v : verts) {
            auto& tr = tris[t];
            if (same(v, tr[0]) || same(v, tr[1]) || same(v, tr[2])) continue;
            int ty;
            double d = std::sqrt(ptDist2(row(X, v), row(X, tr[0]), row(X, tr[1]), row(X, tr[2]), ty));
            if (d < lim) {
                restExcluded++;
                continue;
            }
            ptPairs.push_back({v, tr[0], tr[1], tr[2]});
        }
    for (size_t i = 0; i < edges.size(); i++)
        for (size_t j = i + 1; j < edges.size(); j++) {
            auto& e = edges[i];
            auto& f = edges[j];
            if (same(e[0], f[0]) || same(e[0], f[1]) || same(e[1], f[0]) || same(e[1], f[1])) continue;
            int ty;
            double d = std::sqrt(eeDist2(row(X, e[0]), row(X, e[1]), row(X, f[0]), row(X, f[1]), ty));
            if (d < lim) {
                restExcluded++;
                continue;
            }
            eePairs.push_back({e[0], e[1], f[0], f[1]});
        }
    hingeH.resize(m.hinges.size());
    for (size_t i = 0; i < m.hinges.size(); i++) {
        const Hinge& h = m.hinges[i];
        Vec3 a = row(X, h.n[0]), b = row(X, h.n[1]);
        Vec3 ax = (b - a).normalized();
        auto ht = [&](int w) {
            Vec3 v = row(X, w) - a;
            return (v - v.dot(ax) * ax).norm();
        };
        hingeH[i] = std::min(ht(h.n[2]), ht(h.n[3]));
    }
    for (auto& s : sym) {
        std::set<int> on;
        for (int v : verts)
            if (std::abs(X(v, s.axis) - s.c) < 1e-9 * (1 + std::abs(s.c)) + 1e-12) on.insert(v);
        for (int v : verts) {
            if (on.count(v)) continue;
            wall.push_back({v, s.axis});
            wallC.push_back(s.c);
            wallSide.push_back(X(v, s.axis) > s.c ? 1 : -1);
        }
    }
}

ContactInfo Contact::add(const Model& m, const MatX& Xc, VecX& IF, std::vector<Trip>* T) const {
    ContactInfo info;
    info.restExcluded = restExcluded;
    double lim = dmin + dhat;
    auto pairTerm = [&](const std::array<int, 4>& n, bool pt) {
        Vec3 p0 = row(Xc, n[0]), p1 = row(Xc, n[1]), p2 = row(Xc, n[2]), p3 = row(Xc, n[3]);
        Eigen::AlignedBox3d A, B;
        if (pt) {
            A.extend(p0);
            B.extend(p1);
            B.extend(p2);
            B.extend(p3);
        } else {
            A.extend(p0);
            A.extend(p1);
            B.extend(p2);
            B.extend(p3);
        }
        if (A.exteriorDistance(B) >= lim) return;
        int ty;
        double d2 = pt ? ptDist2(p0, p1, p2, p3, ty) : eeDist2(p0, p1, p2, p3, ty);
        double d = std::sqrt(d2);
        info.minDist = std::min(info.minDist, d);
        if (d >= lim) return;
        double s = std::max(d - dmin, 1e-12 * dhat);
        double b, b1, b2;
        barrier(s, dhat, b, b1, b2);
        D2 q = pt ? ptD2(p0, p1, p2, p3, ty) : eeD2(p0, p1, p2, p3, ty);
        double g1 = b1 / (2 * d), g2 = (b2 - b1 / d) / (4 * d2);
        Eigen::Matrix<double, 12, 1> g = kappa * g1 * q.g;
        Eigen::Matrix<double, 12, 12> H = kappa * (g2 * q.g * q.g.transpose() + g1 * q.h);
        info.energy += kappa * b;
        info.pairs++;
        for (int k = 0; k < 4; k++) IF.segment<3>(3 * n[k]) += g.segment<3>(3 * k);
        if (T) {
            Eigen::Matrix<double, 12, 12> Hp = psd<12>(H);
            for (int r = 0; r < 12; r++)
                for (int c = 0; c < 12; c++) T->emplace_back(3 * n[r / 3] + r % 3, 3 * n[c / 3] + c % 3, Hp(r, c));
        }
    };
    for (auto& p : ptPairs) pairTerm(p, true);
    for (auto& p : eePairs) pairTerm(p, false);
    if (hingeBarrier) {
        for (size_t i = 0; i < m.hinges.size(); i++) {
            const Hinge& h = m.hinges[i];
            if (h.ghostAxis >= 0 || hingeH[i] <= 0) continue;
            Vec3 xj = row(Xc, h.n[0]), xk = row(Xc, h.n[1]), xi = row(Xc, h.n[2]), xl = row(Xc, h.n[3]);
            double th = dihedral(xj, xk, xi, xl);
            for (int side = 0; side < 2; side++) {
                double dd = hingeH[i] * (side == 0 ? th : 2 * PI - th);
                if (dd >= lim) continue;
                double s = std::max(dd - dmin, 1e-12 * dhat), b, b1, b2;
                barrier(s, dhat, b, b1, b2);
                double sg = side == 0 ? 1.0 : -1.0;
                Eigen::Matrix<double, 12, 1> J;
                dihedralGrad(xj, xk, xi, xl, J);
                double c1 = kappa * b1 * hingeH[i] * sg, c2 = kappa * b2 * hingeH[i] * hingeH[i];
                info.energy += kappa * b;
                info.hingePairs++;
                for (int k = 0; k < 4; k++) IF.segment<3>(3 * h.n[k]) += c1 * J.segment<3>(3 * k);
                if (T) {
                    Eigen::Matrix<double, 12, 12> Hh;
                    dihedralHess(xj, xk, xi, xl, J, Hh);
                    Eigen::Matrix<double, 12, 12> K = c2 * J * J.transpose() + c1 * 0.5 * (Hh + Hh.transpose());
                    K = psd<12>(K);
                    for (int r = 0; r < 12; r++)
                        for (int c = 0; c < 12; c++) T->emplace_back(3 * h.n[r / 3] + r % 3, 3 * h.n[c / 3] + c % 3, K(r, c));
                }
            }
        }
    }
    for (size_t w = 0; w < wall.size(); w++) {
        int v = wall[w].first, ax = wall[w].second;
        double d = wallSide[w] * (Xc(v, ax) - wallC[w]);
        info.minDist = std::min(info.minDist, d);
        if (d >= lim) continue;
        double s = std::max(d - dmin, 1e-12 * dhat), b, b1, b2;
        barrier(s, dhat, b, b1, b2);
        info.energy += kappa * b;
        info.pairs++;
        IF[3 * v + ax] += kappa * b1 * wallSide[w];
        if (T) T->emplace_back(3 * v + ax, 3 * v + ax, std::max(kappa * b2, 0.0));
    }
    return info;
}

double Contact::stepSize(const Model& m, const MatX& Xc, const VecX& dU) const {
    double alpha = 1.0;
    auto pos = [&](int i, double t) { return Vec3(row(Xc, i) + t * dU.segment<3>(3 * i)); };
    auto mv = [&](int i) { return dU.segment<3>(3 * i).norm(); };
    auto accd = [&](const std::array<int, 4>& n, bool pt) {
        double lp = pt ? mv(n[0]) + std::max({mv(n[1]), mv(n[2]), mv(n[3])}) : std::max(mv(n[0]), mv(n[1])) + std::max(mv(n[2]), mv(n[3]));
        if (lp <= 0) return 1.0;
        auto dist = [&](double t) {
            int ty;
            return std::sqrt(pt ? ptDist2(pos(n[0], t), pos(n[1], t), pos(n[2], t), pos(n[3], t), ty)
                                : eeDist2(pos(n[0], t), pos(n[1], t), pos(n[2], t), pos(n[3], t), ty));
        };
        double d0 = dist(0) - dmin;
        if (d0 > lp + dhat) return 1.0;
        if (d0 <= 0) return 0.0;
        double t = 0;
        for (int it = 0; it < 500; it++) {
            double d = dist(t) - dmin;
            if (d <= 0.1 * d0) return t;
            t += 0.9 * d / lp;
            if (t >= 1) return 1.0;
        }
        return t;
    };
    for (auto& p : ptPairs) alpha = std::min(alpha, accd(p, true));
    for (auto& p : eePairs) alpha = std::min(alpha, accd(p, false));
    if (hingeBarrier) {
        for (size_t i = 0; i < m.hinges.size(); i++) {
            const Hinge& h = m.hinges[i];
            if (h.ghostAxis >= 0 || hingeH[i] <= 0) continue;
            auto ok = [&](double t) {
                double th = dihedral(pos(h.n[0], t), pos(h.n[1], t), pos(h.n[2], t), pos(h.n[3], t));
                return std::min(th, 2 * PI - th) * hingeH[i] > dmin;
            };
            if (ok(alpha)) {
                bool good = true;
                for (int k = 1; k < 8; k++)
                    if (!ok(alpha * k / 8)) {
                        good = false;
                        break;
                    }
                if (good) continue;
            }
            double lo = 0, hi = alpha;
            for (int it = 0; it < 30; it++) {
                double mid = 0.5 * (lo + hi);
                if (ok(mid))
                    lo = mid;
                else
                    hi = mid;
            }
            alpha = std::min(alpha, lo);
        }
    }
    for (size_t w = 0; w < wall.size(); w++) {
        int v = wall[w].first, ax = wall[w].second;
        double d = wallSide[w] * (Xc(v, ax) - wallC[w]) - dmin;
        double dv = wallSide[w] * dU[3 * v + ax];
        if (dv < 0 && d > 0) alpha = std::min(alpha, 0.9 * d / (-dv));
    }
    return alpha;
}

}
