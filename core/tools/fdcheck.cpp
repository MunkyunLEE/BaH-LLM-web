#include <fstream>
#include <iostream>
#include <random>
#include <sstream>
#include "../src/solver.hpp"
extern "C" int bh_create(const char*);
namespace bh { Analysis* debugGet(int); }
using namespace bh;
static double energy(Analysis& A, const VecX& U) {
    VecX IF; ElemOut o; internal(A.m, U, A.st, IF, nullptr, &o, false);
    double e = o.W.sum() + o.Uh.sum();
    if (A.ct) { VecX g = VecX::Zero(A.m.ndof()); e += A.ct->add(A.m, current(A.m, U), g, nullptr).energy; }
    return e;
}
static VecX force(Analysis& A, const VecX& U) {
    VecX IF; internal(A.m, U, A.st, IF, nullptr, nullptr, false);
    if (A.ct) A.ct->add(A.m, current(A.m, U), IF, nullptr);
    return IF;
}
int main(int argc, char** argv) {
    std::ifstream f(argv[1]); std::stringstream ss; ss << f.rdbuf();
    double amp = argc > 2 ? atof(argv[2]) : 0.05;
    int h = bh_create(ss.str().c_str());
    Analysis& A = *debugGet(h);
    int nd = A.m.ndof();
    std::mt19937 g(3); std::normal_distribution<double> N(0, 1);
    VecX U(nd); for (int i = 0; i < nd; i++) U[i] = amp * N(g) * A.m.L.mean();
    VecX v(nd); for (int i = 0; i < nd; i++) v[i] = N(g);
    double hh = 1e-6 * A.m.L.mean();
    VecX IF = force(A, U);
    double dE = (energy(A, U + hh * v) - energy(A, U - hh * v)) / (2 * hh);
    std::cout << "energy-force rel " << std::abs(dE - IF.dot(v)) / std::max(std::abs(dE), 1e-300) << "\n";
    VecX Fd = (force(A, U + hh * v) - force(A, U - hh * v)) / (2 * hh);
    VecX R; SpMat K; A.evalSystem(U, 0.0, R, K, nullptr);
    VecX Kv = K * v - 1e-8 * v;
    std::cout << "K-force rel (contact psd excluded) " << (Kv - Fd).norm() / Fd.norm() << "\n";
    if (A.hasPressure) {
        VecX f0; std::vector<Trip> T; pressureForce(A.m, A.pl, U, f0, &T);
        SpMat P(nd, nd); P.setFromTriplets(T.begin(), T.end());
        VecX fp, fm; pressureForce(A.m, A.pl, U + hh * v, fp, nullptr); pressureForce(A.m, A.pl, U - hh * v, fm, nullptr);
        std::cout << "pressure tangent rel " << (P * v - (fp - fm) / (2 * hh)).norm() / ((fp - fm) / (2 * hh)).norm() << "\n";
    }
}
