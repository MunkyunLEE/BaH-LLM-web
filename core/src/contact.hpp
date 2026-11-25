#pragma once
#include "bh.hpp"

namespace bh {

struct ContactInfo {
    int pairs = 0, hingePairs = 0, restExcluded = 0;
    double energy = 0, minDist = INF;
};

struct Contact {
    double dmin = 0, dhat = 0, kappa = 0;
    std::vector<std::array<int, 2>> edges;
    std::vector<std::array<int, 3>> tris;
    std::vector<int> verts;
    std::vector<std::array<int, 4>> ptPairs, eePairs;
    std::vector<double> hingeH;
    std::vector<std::pair<int, int>> wall;
    std::vector<double> wallC;
    std::vector<int> wallSide;
    int restExcluded = 0;
    bool hingeBarrier = true;
    void init(const Model& m, double gap, double kappaIn, const std::vector<Symmetry>& sym);
    ContactInfo add(const Model& m, const MatX& Xc, VecX& IF, std::vector<Trip>* T) const;
    double stepSize(const Model& m, const MatX& Xc, const VecX& dU) const;
};

}
