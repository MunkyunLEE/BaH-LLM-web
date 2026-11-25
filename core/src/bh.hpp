#pragma once
#include <Eigen/Dense>
#include <Eigen/Sparse>
#include <array>
#include <cmath>
#include <functional>
#include <limits>
#include <map>
#include <string>
#include <vector>

namespace bh {

using Vec3 = Eigen::Vector3d;
using VecX = Eigen::VectorXd;
using MatX = Eigen::MatrixXd;
using SpMat = Eigen::SparseMatrix<double>;
using Trip = Eigen::Triplet<double>;
constexpr double PI = 3.14159265358979323846;
constexpr double INF = std::numeric_limits<double>::infinity();

enum HingeKind { PANEL_BEND = 0, FOLD = 1, EDGE_BEND = 2 };
enum BarCM { OGDEN = 0, SVK = 1, LOGPLAS = 2 };
enum HingeCM { ENHANCED = 0, SUPERLINEAR = 1, LINEAR = 2, PLASTIC = 3 };

struct Options {
    std::string model = "N5B8";
    std::string calib = "auto";
    double E = 1e3, nu = 0.33, t = 0.15e-2, rho = 0.0;
    double Lratio = -1, Lstar = -1;
    double ogdenA1 = 5, ogdenA2 = 1;
    std::string barCM = "ogden";
    std::string bendCM = "";
    std::string foldCM = "enhanced";
    std::string edgeBendCM = "linear";
    double foldTh1 = 45, foldTh2 = 315, bendTh1 = 45, bendTh2 = 315;
    std::string zeroBend = "asis";
    double zeroBendValue = PI;
    double Abar = 0.1, Kb = 0.1, Kf = -1;
    std::string triBars = "merlin2";
    double Fs = 0.85;
    std::string edgeBend = "woodruff";
    double FB = 0.125;
    double foldScale = 1.0, bendScale = 1.0;
    double barYield = INF, barH = 0;
    double foldYield = INF, foldH = 0, bendYield = INF, bendH = 0;
    double imperfection = 0.0;
    int imperfectionSeed = 1;
    bool compat = false;
};

struct Symmetry {
    int axis = 0;
    double c = 0;
    std::vector<std::array<int, 2>> bars;
};

struct Pressure {
    std::vector<int> faces;
    double p = 0;
    bool local = false;
    Vec3 dir = Vec3(0, 0, -1);
    std::vector<int> flip;
};

struct Input {
    MatX X;
    std::vector<std::vector<int>> panels;
    std::map<std::pair<int, int>, std::string> creases;
    std::vector<std::array<int, 2>> lines;
    double tolDeg = 3.0;
    Options opt;
    std::vector<std::array<int, 4>> supp;
    std::vector<std::pair<int, Vec3>> forces;
    std::vector<std::pair<int, std::array<double, 3>>> disp;
    std::vector<Pressure> pressures;
    std::vector<Symmetry> sym;
};

struct Hinge {
    std::array<int, 4> n;
    int kind = FOLD;
    int cm = ENHANCED;
    double kp = 0, L0 = 0, th0 = PI, th1 = PI / 4, th2 = 7 * PI / 4;
    double factor = 1.0;
    double Y = INF, H = 0;
    int ghostAxis = -1;
    double ghostC = 0;
    int bar = -1;
    std::array<int, 2> edge{-1, -1};
};

struct Model {
    Options opt;
    MatX X;
    int nInput = 0;
    std::vector<int> orig;
    std::vector<std::vector<int>> panels;
    std::vector<int> panelCtr;
    std::vector<std::array<int, 2>> bars;
    VecX A, L;
    std::vector<int> barKind;
    std::vector<Hinge> hinges;
    std::vector<std::array<int, 3>> tris;
    std::vector<int> triPanel;
    VecX mass;
    int nBend = 0, nFold = 0, nBdry = 0;
    std::map<std::pair<int, int>, std::string> edgeType;
    std::map<std::pair<int, int>, double> edgeAngle;
    std::vector<int> fixedDofs;
    std::string note;
    double G = 0;
    int ndof() const { return 3 * (int)X.rows(); }
};

struct State {
    VecX ep, ab, thp, ah, thRef;
    double wpBar = 0, wpHinge = 0;
};

struct ElemOut {
    VecX Sx, Ct, W, Ex;
    VecX th, M, k, Uh;
    VecX newEp, newAb, newThp, newAh, dWp;
};

Model build(const Input& in);
std::vector<int> fixedFromSupp(const Model& m, const std::vector<std::array<int, 4>>& supp, int nInputNodes);

double dihedral(const Vec3& xj, const Vec3& xk, const Vec3& xi, const Vec3& xl);
void dihedralGrad(const Vec3& xj, const Vec3& xk, const Vec3& xi, const Vec3& xl, Eigen::Matrix<double, 12, 1>& J);
void dihedralHess(const Vec3& xj, const Vec3& xk, const Vec3& xi, const Vec3& xl, const Eigen::Matrix<double, 12, 1>& J,
                  Eigen::Matrix<double, 12, 12>& H);

void barLaw(int cm, double C0, double a1, double a2, double Ex, double& S, double& C, double& W);
void hingeLaw(const Hinge& h, double th, double& M, double& k, double& U);

MatX current(const Model& m, const VecX& U);
void internal(const Model& m, const VecX& U, const State& st, VecX& IF, SpMat* K, ElemOut* out, bool regularize = true);
State initState(const Model& m);
void commitState(const Model& m, State& st, const ElemOut& o);

struct PressureLoad {
    std::vector<std::array<int, 3>> tri;
    std::vector<double> p;
    std::vector<int> local;
    std::vector<Vec3> dir;
    std::vector<double> A0;
};
PressureLoad buildPressure(const Model& m, const std::vector<Pressure>& ps);
void pressureForce(const Model& m, const PressureLoad& pl, const VecX& U, VecX& f, std::vector<Trip>* Kp);

}
