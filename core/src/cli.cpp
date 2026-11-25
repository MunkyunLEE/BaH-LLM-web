#include <cstdio>
#include <cstring>
#include <fstream>
#include <iostream>
#include <sstream>
#include <string>
extern "C" {
int bh_create(const char*);
const char* bh_last();
const char* bh_model(int);
int bh_step(int, int);
const char* bh_status(int);
const char* bh_result(int);
double* bh_frames_ptr(int);
int bh_frames_len(int);
const char* bh_modal(int);
const char* bh_kinematic(int);
}
int main(int argc, char** argv) {
    if (argc < 3) { std::cerr << "usage: bhcli input.json outprefix [modal|kinematic]\n"; return 2; }
    std::ifstream f(argv[1]);
    std::stringstream ss; ss << f.rdbuf();
    int h = bh_create(ss.str().c_str());
    if (h < 0) { std::cerr << bh_last() << "\n"; return 1; }
    std::string pre = argv[2];
    std::ofstream(pre + "_model.json") << bh_model(h);
    std::string mode = argc > 3 ? argv[3] : "";
    const char* res;
    if (mode == "modal") res = bh_modal(h);
    else if (mode == "kinematic") res = bh_kinematic(h);
    else { while (!bh_step(h, 10)) {} res = bh_result(h); }
    std::ofstream(pre + "_result.json") << res;
    std::ofstream b(pre + "_frames.bin", std::ios::binary);
    b.write((const char*)bh_frames_ptr(h), sizeof(double) * bh_frames_len(h));
    std::cerr << bh_status(h) << "\n";
    return 0;
}
