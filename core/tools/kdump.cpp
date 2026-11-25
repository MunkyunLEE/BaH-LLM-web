#define JSON_NOEXCEPTION 1
#include <fstream>
#include <iostream>
#include <sstream>
#include "../src/solver.hpp"
extern "C" int bh_create(const char*);
namespace bh { Analysis* debugGet(int); }
int main(int argc, char** argv) {
    std::ifstream f(argv[1]); std::stringstream ss; ss << f.rdbuf();
    int h = bh_create(ss.str().c_str());
    bh::Analysis* A = bh::debugGet(h);
    bh::VecX IF; bh::SpMat K;
    bh::internal(A->m, bh::VecX::Zero(A->m.ndof()), A->st, IF, &K, nullptr, true);
    bh::MatX D(K);
    std::ofstream o(argv[2]); o.precision(17);
    for (int i = 0; i < D.rows(); i++) { for (int j = 0; j < D.cols(); j++) o << D(i,j) << " "; o << "\n"; }
}
