import json
import math
import os
import subprocess
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from objio import read_obj

MERLIN = os.environ.get("MERLIN_DIR", "/home/claude/mrun")
CLI = os.environ.get("BHCLI", os.path.join(HERE, "..", "..", "core", "build", "bhcli"))
REF = os.path.join(HERE, "ref")


def geo(name):
    g = json.load(open(os.path.join(MERLIN, name)))
    return np.array(g["Node"], float).tolist(), (np.array(g["Panel"], int) - 1).tolist()


def kresling(n=6, a=10.0, h=10.0, phi=11 * math.pi / 18):
    R = a / (2 * math.sin(math.pi / n))
    X = [(R * math.cos(2 * math.pi * i / n), R * math.sin(2 * math.pi * i / n), 0.0) for i in range(n)]
    X += [(R * math.cos(2 * math.pi * i / n + phi), R * math.sin(2 * math.pi * i / n + phi), h) for i in range(n)]
    F = []
    for i in range(n):
        b0, b1 = i, (i + 1) % n
        t0, t1 = n + i, n + (i + 1) % n
        F += [[b0, b1, t0], [b1, t1, t0]]
    return [list(x) for x in X], F


def cases():
    out = {}
    V, F = read_obj(os.path.join(HERE, "GMiura_FreeformOri.obj"))
    out["gmiura"] = dict(
        nodes=V, panels=F, supp=[[8, 1, 1, 1], [2, 0, 1, 1], [59, 1, 0, 1]], load=[[59, 0, -30, 0]],
        opt=dict(ModelType="N5B8", MaterCalib="auto", ModElastic=1e3, Poisson=0.3, Thickness=0.25, LScaleFactor=2,
                 LoadType="Displacement", DispStep=200))
    hexn = (np.array([[0, 0, 0], [0, 10, 0], [12, 15, 0], [30, 10, 0], [30, 0, 0], [18, -5, 0]], float) * 2).tolist()
    out["polygon"] = dict(
        nodes=hexn, panels=[[0, 1, 2, 3, 4, 5]], supp=[[1, 1, 1, 1], [2, 1, 0, 1], [4, 0, 0, 1]], load=[[5, 0, 0, -1]],
        opt=dict(ModelType="N5B8", MaterCalib="auto", ModElastic=5e3, Poisson=0.35, Thickness=0.127, LScaleFactor=3,
                 LoadType="Force", InitialLoadFactor=0.00001, MaxIcr=100, StopU=[15, 12]))
    N, P = geo("miura33.json")
    bottom = [1 + 7 * i for i in range(7)]
    top = [7 + 7 * i for i in range(7)]
    out["miura_force"] = dict(
        nodes=N, panels=P, supp=[[b, 1, 1, 1] for b in bottom], load=[[t, 0, 0, -1] for t in top],
        opt=dict(ModelType="N5B8", MaterCalib="auto", ModElastic=1e3, Poisson=0.3, Thickness=1.0, LScaleFactor=3,
                 LoadType="Force", InitialLoadFactor=0.01, MaxIcr=60))
    out["miura_force_el"] = dict(
        nodes=N, panels=P, supp=[[b, 1, 1, 1] for b in bottom], load=[[t, 0, 0, -1] for t in top],
        opt=dict(ModelType="N5B8", MaterCalib="auto", ModElastic=1e3, Poisson=0.3, Thickness=1.0, LScaleFactor=3,
                 BendEL=[45, 315], LoadType="Force", InitialLoadFactor=0.01, MaxIcr=60))
    out["miura_n4b5"] = dict(
        nodes=N, panels=P, supp=[[b, 1, 1, 1] for b in bottom], load=[[49, 0, 0, -5]],
        opt=dict(ModelType="N4B5", MaterCalib="manual", Bar=1e5, Abar=0.1, Kb=0.3, Kf=0.03, EL=[30, 330],
                 LoadType="Displacement", DispStep=50))
    N, P = geo("egg33.json")
    out["eggbox"] = dict(
        nodes=N, panels=P, supp=[[1, 1, 1, 1], [7, 1, 0, 1], [43, 0, 0, 1], [49, 0, 0, 1]], load=[[25, 0, 0, -1]],
        opt=dict(ModelType="N4B5", MaterCalib="manual", Bar=1e8, Abar=1e-5, Kb=2, Kf=0.1, EL=[22.5, 337.5],
                 LoadType="Force", InitialLoadFactor=0.01, MaxIcr=40))
    X, F = kresling()
    out["kresling"] = dict(
        nodes=X, panels=F, supp=[[i + 1, 1, 1, 1] for i in range(6)], load=[[7 + i, 0, 0, -3] for i in range(6)],
        opt=dict(ModelType="N5B8", MaterCalib="auto", ModElastic=1e3, Poisson=0.3, Thickness=0.2, LScaleFactor=3,
                 LoadType="Displacement", DispStep=60))
    return out


def ours(c):
    o = c["opt"]
    opt = {"model": o["ModelType"], "calib": o["MaterCalib"], "compat": True}
    if o["MaterCalib"] == "auto":
        opt.update(E=o["ModElastic"], nu=o["Poisson"], t=o["Thickness"], Lratio=o["LScaleFactor"])
        if "BendEL" in o:
            opt.update(bendCM="enhanced", bendTh1=o["BendEL"][0], bendTh2=o["BendEL"][1])
    else:
        opt.update(E=o["Bar"], Abar=o["Abar"], Kb=o["Kb"], Kf=o["Kf"], foldTh1=o["EL"][0], foldTh2=o["EL"][1],
                   bendTh1=o["EL"][0], bendTh2=o["EL"][1])
    j = {"nodes": c["nodes"], "panels": c["panels"], "options": opt,
         "supports": [[s[0] - 1, s[1], s[2], s[3]] for s in c["supp"]]}
    if o["LoadType"] == "Force":
        j["forces"] = [[l[0] - 1, l[1], l[2], l[3]] for l in c["load"]]
        a = {"type": "force", "maxIcr": o["MaxIcr"], "lambda0": o["InitialLoadFactor"]}
        if "StopU" in o:
            d = o["StopU"][0] - 1
            a["stop"] = [{"node": d // 3, "dir": d % 3, "value": o["StopU"][1]}]
        j["analysis"] = a
    else:
        j["displacements"] = [[l[0] - 1] + [v if v != 0 else None for v in l[1:]] for l in c["load"]]
        j["analysis"] = {"type": "displacement", "dispStep": o["DispStep"], "exact": False}
    return j


def run_matlab(name, c):
    os.makedirs(REF, exist_ok=True)
    mc = {"Node": c["nodes"], "Panel": [[v + 1 for v in f] for f in c["panels"]], "Supp": c["supp"], "Load": c["load"], "Opt": c["opt"]}
    fn = os.path.join(MERLIN, f"case_{name}.json")
    json.dump(mc, open(fn, "w"))
    pre = os.path.join(MERLIN, f"out_{name}")
    subprocess.run(["octave-cli", "-q", "--eval", f"cd('{MERLIN}'); run_case('{fn}','{pre}')"], check=True,
                   stdout=subprocess.DEVNULL)
    ld = lambda s: np.atleast_1d(np.loadtxt(f"{pre}_{s}.txt"))
    np.savez_compressed(os.path.join(REF, f"{name}.npz"), U=np.loadtxt(f"{pre}_U.txt", ndmin=2),
                        F=ld("F"), E=np.atleast_2d(np.loadtxt(f"{pre}_E.txt")), bars=ld("bars"), A=ld("A"), node=ld("node"))


def run_ours(name, c):
    fn = f"/tmp/case_{name}.json"
    json.dump(ours(c), open(fn, "w"))
    subprocess.run([CLI, fn, f"/tmp/out_{name}"], check=True, stderr=subprocess.DEVNULL)
    m = json.load(open(f"/tmp/out_{name}_model.json"))
    r = json.load(open(f"/tmp/out_{name}_result.json"))
    fr = np.fromfile(f"/tmp/out_{name}_frames.bin").reshape(-1, r["stride"])
    return m, r, fr


def compare(name, c):
    ref = np.load(os.path.join(REF, f"{name}.npz"))
    m, r, fr = run_ours(name, c)
    nd = r["nd"]
    U = fr[1:, :nd].T
    mU = ref["U"]
    bars_ok = np.array_equal(np.array(m["bars"]) + 1, ref["bars"].reshape(-1, 2).astype(int))
    A_rel = float(np.abs(np.array(m["A"]) - ref["A"]).max() / np.abs(ref["A"]).max())
    res = {"case": name, "bars_equal": bars_ok, "A_rel": A_rel, "incr_ours": U.shape[1], "incr_merlin": mU.shape[1]}
    k = min(U.shape[1], mU.shape[1])
    res["U_rel"] = float(np.abs(U[:, :k] - mU[:, :k]).max() / np.abs(mU).max())
    if c["opt"]["LoadType"] == "Force":
        F = np.array(r["lam"][1:])
        mF = ref["F"]
    else:
        imp = [3 * (l[0] - 1) + q for l in c["load"] for q in range(3) if l[1 + q] != 0]
        F = -fr[1:, nd:2 * nd][:, imp]
        mF = ref["F"].reshape(len(ref["F"]), -1)
        F = F.reshape(len(F), -1)
    res["F_rel"] = float(np.abs(F[:k] - mF[:k]).max() / max(np.abs(mF).max(), 1e-300))
    E = ref["E"].reshape(4, -1)
    ours_E = np.array([np.array(r["US"]) + np.array(r["UF"]) + np.array(r["UB"]), r["US"], r["UF"], r["UB"]])[:, 1:]
    res["E_rel"] = float(np.abs(ours_E[:, :k] - E[:, :k]).max() / max(np.abs(E).max(), 1e-300))
    return res


if __name__ == "__main__":
    cs = cases()
    names = sys.argv[2:] or list(cs)
    if sys.argv[1] == "ref":
        for n in names:
            run_matlab(n, cs[n])
            print("ref", n)
    else:
        rows = [compare(n, cs[n]) for n in names]
        for r in rows:
            print(json.dumps(r))
