#pragma once
#include <memory>

#include "bh.hpp"
#include "contact.hpp"

namespace bh {

struct StopRule {
    int node = -1, dir = 0;
    double value = 0;
};

struct Settings {
    std::string type = "displacement";
    int dispStep = 100;
    int maxIcr = 100;
    double lambda0 = 0.01;
    double lamMax = -1;
    double tol = 1e-6;
    int maxIter = 50;
    bool exact = true;
    int cycles = 0;
    double cycleBack = 0;
    bool contact = false;
    double gap = -1, kappa = -1;
    bool hingeBarrier = true;
    int modes = 12;
    bool useMass = true;
    bool modalDeformed = false;
    std::vector<StopRule> stop;
    std::vector<int> drivers;
    std::vector<std::array<int, 2>> driverEdges;
    std::vector<double> targets;
    int kinSteps = 60;
};

struct Frame {
    VecX U;
    double lam = 0, s = 0;
    double US = 0, UF = 0, UB = 0, UE = 0, Wp = 0, Uc = 0, Wext = 0;
    int iters = 0, contactPairs = 0;
    double minDist = INF;
    VecX Fimp, Eb, Ef, Ebd, Sx;
};

struct Analysis {
    Model m;
    Settings set;
    std::vector<int> fixed, free, imp;
    VecX F, Ubar;
    PressureLoad pl;
    bool hasPressure = false, follower = false;
    std::unique_ptr<Contact> ct;
    State st;
    std::vector<Frame> frames;
    std::vector<std::string> notes;
    bool done = false;
    std::string status;
    VecX U;
    double lmd = 0, bl = 0;
    int icrm = 0;
    VecX dupp1, dupc1;
    double sinal = 1, numgsp = 0;
    std::vector<VecX> Uhis;
    std::vector<double> Fhis;
    std::vector<State> Shis;
    int leg = 0;
    std::vector<VecX> legEnd;
    VecX legStart, Fdsp;
    double dspmvd = 0, mv = 1, damping = 1;
    int attmpts = 0;
    int ctBlocked = 0;
    VecX Fprev;
    VecX Uprev;
    double Wext = 0;

    void setup(const Input& in, const Settings& s);
    void step(int maxIncr);
    VecX fext(const VecX& Uc, double scale, std::vector<Trip>* Kp);
    void evalSystem(const VecX& Uc, double lam, VecX& R, SpMat& K, ContactInfo* ci);
    Frame record(const VecX& Uc, double lam, double s, int iters);
    bool stopNow(const VecX& Uc) const;
    void stepForce();
    void stepDisp();
    std::string modal(std::vector<double>& eig, std::vector<VecX>& shapes, int& rigid);
    std::string kinematics(int& mech, int& selfStress, int& rank, std::vector<VecX>& path, std::vector<VecX>& angles);
    VecX hingeAngles(const VecX& x) const;
    std::vector<int> kinFree() const;
    void dofInfo(int& constraints, int& freeDofs, int& rank, int& mech, int& selfStress) const;
    void nullModes(std::vector<VecX>& modes, MatX& rates, std::vector<int>& foldIdx) const;
    void foldPath(const std::vector<int>& drv, const VecX& targets, int steps, std::vector<VecX>& xs, std::vector<VecX>& angles, std::vector<double>& err) const;
    int solutionSpace(const std::vector<int>& hid, int ndir, double amp, int steps, std::vector<std::vector<Vec3>>& paths) const;
    int hingeOfEdge(int a, int b) const;
};

VecX solveLinear(const SpMat& K, const std::vector<int>& free, const MatX& rhs, MatX& out);

}
