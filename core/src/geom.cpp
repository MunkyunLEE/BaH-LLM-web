#include "bh.hpp"

namespace bh {

double dihedral(const Vec3& xj, const Vec3& xk, const Vec3& xi, const Vec3& xl) {
    Vec3 rkj = xk - xj, rij = xi - xj, rkl = xk - xl;
    Vec3 m = rij.cross(rkj), n = rkj.cross(rkl);
    double trip = n.dot(rij);
    double sgn = std::abs(trip) > 1e-8 ? (trip > 0 ? 1.0 : -1.0) : 1.0;
    double s = rkj.norm() * std::abs(trip);
    double c = m.dot(n);
    double th = sgn * std::atan2(s, c);
    if (th < 0) th += 2 * PI;
    return th;
}

void dihedralGrad(const Vec3& xj, const Vec3& xk, const Vec3& xi, const Vec3& xl, Eigen::Matrix<double, 12, 1>& J) {
    Vec3 rkj = xk - xj, rij = xi - xj, rkl = xk - xl;
    Vec3 m = rij.cross(rkj), n = rkj.cross(rkl);
    double m2 = m.squaredNorm(), n2 = n.squaredNorm(), k2 = rkj.squaredNorm(), k = std::sqrt(k2);
    Vec3 di = m * (k / m2);
    Vec3 dl = -n * (k / n2);
    double a = rij.dot(rkj) / k2, b = rkl.dot(rkj) / k2;
    Vec3 dj = di * (a - 1) - dl * b;
    Vec3 dk = -di * a + dl * (b - 1);
    J << dj, dk, di, dl;
}

static Eigen::Matrix3d sym2(const Vec3& a, const Vec3& b) { return a * b.transpose() + b * a.transpose(); }

void dihedralHess(const Vec3& xj, const Vec3& xk, const Vec3& xi, const Vec3& xl, const Eigen::Matrix<double, 12, 1>& J,
                  Eigen::Matrix<double, 12, 12>& H) {
    Vec3 rkj = xk - xj, rij = xi - xj, rkl = xk - xl;
    Vec3 m = rij.cross(rkj), n = rkj.cross(rkl);
    double m2 = m.squaredNorm(), n2 = n.squaredNorm(), k2 = rkj.squaredNorm(), k = std::sqrt(k2);
    Vec3 dj = J.segment<3>(0), dk = J.segment<3>(3), di = J.segment<3>(6), dl = J.segment<3>(9);
    (void)dj;
    (void)dk;
    double a = rij.dot(rkj) / k2, b = rkl.dot(rkj) / k2;
    Eigen::Matrix3d dii = -sym2(m, rkj.cross(m)) * (k / (m2 * m2));
    Eigen::Matrix3d dij = -(m * rkj.transpose()) / (m2 * k) + sym2(m, (rkj - rij).cross(m)) * (k / (m2 * m2));
    Eigen::Matrix3d dik = (m * rkj.transpose()) / (m2 * k) + sym2(m, rij.cross(m)) * (k / (m2 * m2));
    Eigen::Matrix3d dll = sym2(n, rkj.cross(n)) * (k / (n2 * n2));
    Eigen::Matrix3d dlk = -(n * rkj.transpose()) / (n2 * k) - sym2(n, (rkj - rkl).cross(n)) * (k / (n2 * n2));
    Eigen::Matrix3d dlj = (n * rkj.transpose()) / (n2 * k) - sym2(n, rkl.cross(n)) * (k / (n2 * n2));
    Vec3 dT1jj = (rkj * (-1 + 2 * a) - rij) / k2;
    Vec3 dT2jj = (rkj * (2 * b) - rkl) / k2;
    Eigen::Matrix3d djj = di * dT1jj.transpose() + dij * (a - 1) - dl * dT2jj.transpose() - dlj * b;
    Vec3 dT1jk = (rkj * (-2 * a) + rij) / k2;
    Vec3 dT2jk = (rkj * (1 - 2 * b) + rkl) / k2;
    Eigen::Matrix3d djk = di * dT1jk.transpose() + dik * (a - 1) - dl * dT2jk.transpose() - dlk * b;
    Vec3 dT1kk = dT2jk, dT2kk = dT1jk;
    Eigen::Matrix3d dkk = dl * dT1kk.transpose() + dlk * (b - 1) - di * dT2kk.transpose() - dik * a;
    H.setZero();
    H.block<3, 3>(0, 0) = djj;
    H.block<3, 3>(6, 6) = dii;
    H.block<3, 3>(3, 3) = dkk;
    H.block<3, 3>(9, 9) = dll;
    H.block<3, 3>(0, 3) = djk;
    H.block<3, 3>(3, 0) = djk.transpose();
    H.block<3, 3>(6, 0) = dij;
    H.block<3, 3>(0, 6) = dij.transpose();
    H.block<3, 3>(9, 0) = dlj;
    H.block<3, 3>(0, 9) = dlj.transpose();
    H.block<3, 3>(6, 3) = dik;
    H.block<3, 3>(3, 6) = dik.transpose();
    H.block<3, 3>(9, 3) = dlk;
    H.block<3, 3>(3, 9) = dlk.transpose();
}

}
