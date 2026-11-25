#define JSON_NOEXCEPTION 1
#include <map>
#include <memory>
#include <string>

#include "../third_party/json.hpp"
#include "solver.hpp"

using json = nlohmann::json;
using namespace bh;

namespace {

double num(const json& j, const char* k, double d) {
    if (!j.is_object()) return d;
    auto it = j.find(k);
    if (it == j.end() || !it->is_number()) return d;
    return it->get<double>();
}
int inum(const json& j, const char* k, int d) { return (int)num(j, k, d); }
bool boolean(const json& j, const char* k, bool d) {
    if (!j.is_object()) return d;
    auto it = j.find(k);
    if (it == j.end()) return d;
    if (it->is_boolean()) return it->get<bool>();
    if (it->is_number()) return it->get<double>() != 0;
    return d;
}
std::string str(const json& j, const char* k, const std::string& d) {
    if (!j.is_object()) return d;
    auto it = j.find(k);
    if (it == j.end() || !it->is_string()) return d;
    return it->get<std::string>();
}
double numOr(const json& v, double d) { return v.is_number() ? v.get<double>() : d; }

std::pair<int, int> parseEdge(const std::string& s) {
    auto p = s.find('-');
    if (p == std::string::npos) return {-1, -1};
    return {std::atoi(s.substr(0, p).c_str()), std::atoi(s.substr(p + 1).c_str())};
}

int axisOf(const json& v) {
    if (v.is_number()) return v.get<int>();
    if (v.is_string()) {
        std::string s = v.get<std::string>();
        if (s == "x" || s == "X") return 0;
        if (s == "y" || s == "Y") return 1;
        if (s == "z" || s == "Z") return 2;
    }
    return 0;
}

bool parse(const json& j, Input& in, Settings& set, std::string& err) {
    if (!j.is_object() || !j.contains("nodes") || !j.contains("panels")) {
        err = "nodes/panels missing";
        return false;
    }
    const json& N = j["nodes"];
    in.X.resize(N.size(), 3);
    for (size_t i = 0; i < N.size(); i++)
        for (int q = 0; q < 3; q++) in.X(i, q) = numOr(N[i][q], 0.0);
    for (auto& p : j["panels"]) {
        std::vector<int> f;
        for (auto& v : p) f.push_back(v.get<int>());
        if (f.size() < 3) {
            err = "panel needs 3 or more nodes";
            return false;
        }
        for (int v : f)
            if (v < 0 || v >= (int)N.size()) {
                err = "panel index out of range";
                return false;
            }
        in.panels.push_back(f);
    }
    if (j.contains("creases")) {
        const json& c = j["creases"];
        if (c.is_object()) {
            for (auto it = c.begin(); it != c.end(); ++it) {
                auto e = parseEdge(it.key());
                if (e.first >= 0 && it->is_string()) in.creases[{std::min(e.first, e.second), std::max(e.first, e.second)}] = it->get<std::string>();
            }
        } else if (c.is_array()) {
            for (auto& x : c) {
                if (!x.contains("edge") || !x["edge"].is_array()) continue;
                int a = x["edge"][0].get<int>(), b = x["edge"][1].get<int>();
                in.creases[{std::min(a, b), std::max(a, b)}] = str(x, "type", "fold");
            }
        }
    }
    if (j.contains("lines"))
        for (auto& l : j["lines"]) in.lines.push_back({l[0].get<int>(), l[1].get<int>()});
    in.tolDeg = num(j, "tolDeg", 3.0);
    const json& o = j.contains("options") ? j["options"] : json::object();
    Options& op = in.opt;
    op.model = str(o, "model", op.model);
    op.calib = str(o, "calib", op.calib);
    op.E = num(o, "E", op.E);
    op.nu = num(o, "nu", op.nu);
    op.t = num(o, "t", op.t);
    op.rho = num(o, "rho", op.rho);
    op.Lratio = num(o, "Lratio", op.Lratio);
    op.Lstar = num(o, "Lstar", op.Lstar);
    op.ogdenA1 = num(o, "ogdenA1", op.ogdenA1);
    op.ogdenA2 = num(o, "ogdenA2", op.ogdenA2);
    op.barCM = str(o, "barCM", op.barCM);
    op.bendCM = str(o, "bendCM", op.bendCM);
    op.foldCM = str(o, "foldCM", op.foldCM);
    op.edgeBendCM = str(o, "edgeBendCM", op.edgeBendCM);
    op.foldTh1 = num(o, "foldTh1", op.foldTh1);
    op.foldTh2 = num(o, "foldTh2", op.foldTh2);
    op.bendTh1 = num(o, "bendTh1", op.bendTh1);
    op.bendTh2 = num(o, "bendTh2", op.bendTh2);
    op.zeroBend = str(o, "zeroBend", op.zeroBend);
    op.zeroBendValue = num(o, "zeroBendValue", op.zeroBendValue);
    op.Abar = num(o, "Abar", op.Abar);
    op.Kb = num(o, "Kb", op.Kb);
    op.Kf = num(o, "Kf", op.Kf);
    op.triBars = str(o, "triBars", op.triBars);
    op.Fs = num(o, "Fs", op.Fs);
    op.edgeBend = str(o, "edgeBend", op.edgeBend);
    op.FB = num(o, "FB", op.FB);
    op.foldScale = num(o, "foldScale", op.foldScale);
    op.bendScale = num(o, "bendScale", op.bendScale);
    op.barYield = num(o, "barYield", op.barYield);
    op.barH = num(o, "barH", op.barH);
    op.foldYield = num(o, "foldYield", op.foldYield);
    op.foldH = num(o, "foldH", op.foldH);
    op.bendYield = num(o, "bendYield", op.bendYield);
    op.bendH = num(o, "bendH", op.bendH);
    op.imperfection = num(o, "imperfection", op.imperfection);
    op.imperfectionSeed = inum(o, "imperfectionSeed", op.imperfectionSeed);
    op.compat = boolean(o, "compat", op.compat);
    if (j.contains("supports"))
        for (auto& s : j["supports"]) in.supp.push_back({s[0].get<int>(), (int)numOr(s[1], 0), (int)numOr(s[2], 0), (int)numOr(s[3], 0)});
    if (j.contains("forces"))
        for (auto& s : j["forces"]) in.forces.push_back({s[0].get<int>(), Vec3(numOr(s[1], 0), numOr(s[2], 0), numOr(s[3], 0))});
    if (j.contains("displacements"))
        for (auto& s : j["displacements"]) {
            std::array<double, 3> d;
            for (int q = 0; q < 3; q++) d[q] = s[q + 1].is_number() ? s[q + 1].get<double>() : std::nan("");
            in.disp.push_back({s[0].get<int>(), d});
        }
    if (j.contains("pressures"))
        for (auto& p : j["pressures"]) {
            Pressure pr;
            if (p.contains("faces"))
                for (auto& f : p["faces"]) pr.faces.push_back(f.get<int>());
            pr.p = num(p, "p", 0);
            pr.local = str(p, "mode", "global") == "local";
            if (p.contains("dir") && p["dir"].is_array()) pr.dir = Vec3(numOr(p["dir"][0], 0), numOr(p["dir"][1], 0), numOr(p["dir"][2], -1));
            if (p.contains("flip"))
                for (auto& f : p["flip"]) pr.flip.push_back(f.get<int>());
            in.pressures.push_back(pr);
        }
    if (j.contains("symmetry"))
        for (auto& s : j["symmetry"]) {
            Symmetry sy;
            sy.axis = axisOf(s.contains("axis") ? s["axis"] : json(0));
            sy.c = num(s, "c", 0);
            if (s.contains("bars"))
                for (auto& b : s["bars"]) sy.bars.push_back({b[0].get<int>(), b[1].get<int>()});
            in.sym.push_back(sy);
        }
    const json& a = j.contains("analysis") ? j["analysis"] : json::object();
    set.type = str(a, "type", set.type);
    set.dispStep = std::max(1, inum(a, "dispStep", set.dispStep));
    set.maxIcr = std::max(1, inum(a, "maxIcr", set.maxIcr));
    set.lambda0 = num(a, "lambda0", set.lambda0);
    set.lamMax = num(a, "lamMax", set.lamMax);
    set.tol = num(a, "tol", set.tol);
    set.maxIter = inum(a, "maxIter", set.maxIter);
    set.exact = boolean(a, "exact", set.exact);
    set.cycles = inum(a, "cycles", set.cycles);
    set.cycleBack = num(a, "cycleBack", set.cycleBack);
    set.contact = boolean(a, "contact", set.contact);
    set.gap = num(a, "gap", set.gap);
    set.kappa = num(a, "kappa", set.kappa);
    set.hingeBarrier = boolean(a, "hingeBarrier", set.hingeBarrier);
    set.modes = inum(a, "modes", set.modes);
    set.useMass = boolean(a, "useMass", set.useMass);
    set.modalDeformed = boolean(a, "modalDeformed", set.modalDeformed);
    set.kinSteps = inum(a, "kinSteps", set.kinSteps);
    if (a.contains("stop"))
        for (auto& s : a["stop"]) {
            StopRule r;
            r.node = inum(s, "node", -1);
            r.dir = axisOf(s.contains("dir") ? s["dir"] : json(0));
            r.value = num(s, "value", 0);
            set.stop.push_back(r);
        }
    if (a.contains("drivers"))
        for (auto& d : a["drivers"]) set.drivers.push_back(d.get<int>());
    if (a.contains("driverEdges"))
        for (auto& d : a["driverEdges"]) set.driverEdges.push_back({d[0].get<int>(), d[1].get<int>()});
    if (a.contains("targets"))
        for (auto& d : a["targets"]) set.targets.push_back(d.get<double>());
    return true;
}

const char* kindName(int k) { return k == FOLD ? "fold" : (k == PANEL_BEND ? "panel" : "bend"); }

json modelJson(const Analysis& A) {
    const Model& m = A.m;
    json j;
    json X = json::array();
    for (int i = 0; i < m.X.rows(); i++) X.push_back({m.X(i, 0), m.X(i, 1), m.X(i, 2)});
    j["nodes"] = X;
    j["nInput"] = m.nInput;
    j["orig"] = m.orig;
    json B = json::array();
    for (auto& b : m.bars) B.push_back({b[0], b[1]});
    j["bars"] = B;
    j["barKind"] = m.barKind;
    j["A"] = std::vector<double>(m.A.data(), m.A.data() + m.A.size());
    j["L"] = std::vector<double>(m.L.data(), m.L.data() + m.L.size());
    json H = json::array();
    for (auto& h : m.hinges) {
        json q;
        q["n"] = {h.n[0], h.n[1], h.n[2], h.n[3]};
        q["kind"] = kindName(h.kind);
        q["kp"] = h.kp;
        q["k"] = h.kp * h.L0 * h.factor;
        q["L0"] = h.L0;
        q["th0"] = h.th0;
        q["bar"] = h.bar;
        q["edge"] = {h.edge[0], h.edge[1]};
        q["ghost"] = h.ghostAxis;
        H.push_back(q);
    }
    j["hinges"] = H;
    json T = json::array();
    for (auto& t : m.tris) T.push_back({t[0], t[1], t[2]});
    j["tris"] = T;
    j["triPanel"] = m.triPanel;
    j["panelCtr"] = m.panelCtr;
    json P = json::array();
    for (auto& f : m.panels) P.push_back(f);
    j["panels"] = P;
    json E = json::array();
    for (auto& kv : m.edgeType) {
        json e;
        e["e"] = {kv.first.first, kv.first.second};
        e["type"] = kv.second;
        auto it = m.edgeAngle.find(kv.first);
        e["angle"] = it == m.edgeAngle.end() ? json(nullptr) : json(it->second);
        E.push_back(e);
    }
    j["edges"] = E;
    j["note"] = m.note;
    j["G"] = m.G;
    j["fixed"] = A.fixed;
    j["imp"] = A.imp;
    j["nBend"] = m.nBend;
    j["nFold"] = m.nFold;
    j["nBdry"] = m.nBdry;
    double mass = m.mass.sum();
    j["mass"] = mass;
    return j;
}

struct Session {
    Analysis A;
    std::string buf;
    std::vector<double> frames;
};

std::map<int, std::unique_ptr<Session>> sessions;
int nextId = 1;
std::string lastMsg;

json frameScalars(const Analysis& A) {
    json j;
    std::vector<double> lam, s, US, UF, UB, UE, Wp, Uc, Wext, md;
    std::vector<int> it, cp;
    for (auto& f : A.frames) {
        lam.push_back(f.lam);
        s.push_back(f.s);
        US.push_back(f.US);
        UF.push_back(f.UF);
        UB.push_back(f.UB);
        UE.push_back(f.UE);
        Wp.push_back(f.Wp);
        Uc.push_back(f.Uc);
        Wext.push_back(f.Wext);
        it.push_back(f.iters);
        cp.push_back(f.contactPairs);
        md.push_back(std::isfinite(f.minDist) ? f.minDist : -1);
    }
    j["lam"] = lam;
    j["s"] = s;
    j["US"] = US;
    j["UF"] = UF;
    j["UB"] = UB;
    j["UE"] = UE;
    j["Wp"] = Wp;
    j["Uc"] = Uc;
    j["Wext"] = Wext;
    j["iters"] = it;
    j["contactPairs"] = cp;
    j["minDist"] = md;
    return j;
}

void packFrames(Session& S) {
    const Model& m = S.A.m;
    int nd = m.ndof(), nn = (int)m.X.rows();
    S.frames.clear();
    for (auto& f : S.A.frames) {
        S.frames.insert(S.frames.end(), f.U.data(), f.U.data() + nd);
        S.frames.insert(S.frames.end(), f.Fimp.data(), f.Fimp.data() + nd);
        S.frames.insert(S.frames.end(), f.Eb.data(), f.Eb.data() + nn);
        S.frames.insert(S.frames.end(), f.Ef.data(), f.Ef.data() + nn);
        S.frames.insert(S.frames.end(), f.Ebd.data(), f.Ebd.data() + nn);
    }
}

Session* get(int h) {
    auto it = sessions.find(h);
    return it == sessions.end() ? nullptr : it->second.get();
}

}

extern "C" {

char* bh_alloc(int n) { return new char[n + 1]; }
void bh_free(char* p) { delete[] p; }
const char* bh_last() { return lastMsg.c_str(); }

int bh_create(const char* text) {
    json j = json::parse(text, nullptr, false);
    if (j.is_discarded()) {
        lastMsg = "{\"error\":\"json parse\"}";
        return -1;
    }
    Input in;
    Settings set;
    std::string err;
    if (!parse(j, in, set, err)) {
        lastMsg = json({{"error", err}}).dump();
        return -1;
    }
    std::unique_ptr<Session> S(new Session());
    S->A.setup(in, set);
    int id = nextId++;
    sessions[id] = std::move(S);
    lastMsg = "{}";
    return id;
}

void bh_destroy(int h) { sessions.erase(h); }

const char* bh_model(int h) {
    Session* S = get(h);
    if (!S) return "{}";
    S->buf = modelJson(S->A).dump();
    return S->buf.c_str();
}

int bh_step(int h, int n) {
    Session* S = get(h);
    if (!S) return 1;
    S->A.step(n);
    return S->A.done ? 1 : 0;
}

const char* bh_status(int h) {
    Session* S = get(h);
    if (!S) return "{}";
    json j;
    j["done"] = S->A.done;
    j["status"] = S->A.status;
    j["frames"] = (int)S->A.frames.size();
    j["icrm"] = S->A.icrm;
    const Frame& f = S->A.frames.back();
    j["lam"] = f.lam;
    j["s"] = f.s;
    j["dspmvd"] = S->A.dspmvd;
    j["leg"] = S->A.leg;
    j["legs"] = (int)S->A.legEnd.size();
    S->buf = j.dump();
    return S->buf.c_str();
}

const char* bh_result(int h) {
    Session* S = get(h);
    if (!S) return "{}";
    packFrames(*S);
    json j = frameScalars(S->A);
    j["status"] = S->A.status;
    j["notes"] = S->A.notes;
    j["nd"] = S->A.m.ndof();
    j["nn"] = (int)S->A.m.X.rows();
    j["stride"] = 2 * S->A.m.ndof() + 3 * (int)S->A.m.X.rows();
    j["F"] = std::vector<double>(S->A.F.data(), S->A.F.data() + S->A.F.size());
    j["Ubar"] = std::vector<double>(S->A.Ubar.data(), S->A.Ubar.data() + S->A.Ubar.size());
    S->buf = j.dump();
    return S->buf.c_str();
}

double* bh_frames_ptr(int h) {
    Session* S = get(h);
    return S ? S->frames.data() : nullptr;
}
int bh_frames_len(int h) {
    Session* S = get(h);
    return S ? (int)S->frames.size() : 0;
}

const char* bh_modal(int h) {
    Session* S = get(h);
    if (!S) return "{}";
    std::vector<double> eig;
    std::vector<VecX> sh;
    int rigid = 0;
    std::string msg = S->A.modal(eig, sh, rigid);
    json j;
    j["error"] = msg;
    j["eig"] = eig;
    j["rigid"] = rigid;
    std::vector<double> fr;
    for (double e : eig) fr.push_back(std::sqrt(std::max(e, 0.0)) / (2 * PI));
    j["freq"] = fr;
    S->frames.clear();
    for (auto& v : sh) S->frames.insert(S->frames.end(), v.data(), v.data() + v.size());
    j["nd"] = S->A.m.ndof();
    S->buf = j.dump();
    return S->buf.c_str();
}

const char* bh_kinematic(int h) {
    Session* S = get(h);
    if (!S) return "{}";
    int mech = 0, ss = 0, rank = 0;
    std::vector<VecX> path, ang;
    std::string kmsg = S->A.kinematics(mech, ss, rank, path, ang);
    json j;
    if (kmsg.empty() && S->A.set.drivers.empty() && mech > 0) {
        std::vector<VecX> modes;
        MatX rates;
        std::vector<int> fi;
        S->A.nullModes(modes, rates, fi);
        path.clear();
        ang.clear();
        int cnt = std::min((int)modes.size(), std::max(S->A.set.modes, 1));
        VecX a0 = S->A.hingeAngles(VecX::Zero(S->A.m.ndof()));
        for (int k = 0; k < cnt; k++) {
            VecX md = modes[k];
            double am = md.cwiseAbs().maxCoeff();
            if (am > 0) md /= am;
            path.push_back(md);
            ang.push_back(a0);
        }
        j["mechModes"] = cnt;
    }
    j["error"] = kmsg;
    j["mechanisms"] = mech;
    j["selfStress"] = ss;
    j["rank"] = rank;
    json A = json::array();
    for (auto& a : ang) A.push_back(std::vector<double>(a.data(), a.data() + a.size()));
    j["angles"] = A;
    S->frames.clear();
    for (auto& v : path) S->frames.insert(S->frames.end(), v.data(), v.data() + v.size());
    j["nd"] = S->A.m.ndof();
    j["count"] = (int)path.size();
    S->buf = j.dump();
    return S->buf.c_str();
}
}
extern "C" {
const char* bh_dof(int h) {
    Session* S = get(h);
    if (!S) return "{}";
    int nc = 0, nf = 0, rank = 0, mech = 0, ss = 0;
    S->A.dofInfo(nc, nf, rank, mech, ss);
    json j;
    j["constraints"] = nc;
    j["freeDofs"] = nf;
    j["rank"] = rank;
    j["mechanisms"] = mech;
    j["selfStress"] = ss;
    j["rigidRemoved"] = S->A.fixed.empty() ? 6 : 0;
    S->buf = j.dump();
    return S->buf.c_str();
}

const char* bh_space(int h, const char* spec) {
    Session* S = get(h);
    if (!S) return "{}";
    json q = json::parse(spec, nullptr, false);
    json j;
    std::vector<int> hid;
    json miss = json::array();
    if (q.is_object() && q.contains("edges"))
        for (auto& e : q["edges"]) {
            int a = e[0].get<int>(), b = e[1].get<int>();
            int k = S->A.hingeOfEdge(a, b);
            if (k < 0) miss.push_back({a, b});
            hid.push_back(k);
        }
    int ndir = q.is_object() ? (int)numOr(q.value("ndir", json(24)), 24) : 24;
    int steps = q.is_object() ? (int)numOr(q.value("steps", json(60)), 60) : 60;
    double amp = q.is_object() ? numOr(q.value("amp", json(PI * 0.9)), PI * 0.9) : PI * 0.9;
    std::vector<std::vector<Vec3>> paths;
    int dof = S->A.solutionSpace(hid, ndir, amp, steps, paths);
    json P = json::array();
    for (auto& p : paths) {
        json one = json::array();
        for (auto& v : p) one.push_back({v[0], v[1], v[2]});
        P.push_back(one);
    }
    j["dof"] = dof;
    j["paths"] = P;
    j["missing"] = miss;
    j["hinges"] = hid;
    S->buf = j.dump();
    return S->buf.c_str();
}
}

namespace bh { Analysis* debugGet(int h) { auto* S = get(h); return S ? &S->A : nullptr; } }
