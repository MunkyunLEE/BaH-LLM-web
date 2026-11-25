import json, subprocess, numpy as np, os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
CLI = os.path.join(HERE, '..', '..', 'core', 'build', 'bhcli')
g = json.load(open(os.path.join(HERE, 'miura33.json')))
N = np.array(g['Node']); P = np.array(g['Panel']) - 1
opt = {"model": "N5B8", "calib": "auto", "E": 1e3, "nu": 0.3, "t": 1.0, "Lratio": 3, "bendCM": "enhanced"}
bottom = [7 * i for i in range(7)]; top = [6 + 7 * i for i in range(7)]
full = {"nodes": N.tolist(), "panels": P.tolist(), "options": opt,
        "supports": [[b, 1, 1, 1] for b in bottom], "displacements": [[t, None, None, -2.0] for t in top],
        "analysis": {"type": "displacement", "dispStep": 20}}
keep = [k for k in range(len(P)) if (k % 6) < 3]
nodes_half = list(range(28))
half = dict(full)
half["nodes"] = N[:28].tolist(); half["panels"] = P[keep].tolist()
half["supports"] = [[b, 1, 1, 1] for b in bottom if b < 28]
half["displacements"] = [[t, None, None, -2.0] for t in top if t < 28]
xc = N[21, 0]
half["symmetry"] = [{"axis": "x", "c": xc, "bars": [[21 + j, 22 + j] for j in range(6)]}]
def run(spec, tag):
    json.dump(spec, open(f'/tmp/sym_{tag}.json', 'w'))
    subprocess.run([CLI, f'/tmp/sym_{tag}.json', f'/tmp/sym_{tag}'], check=True, stderr=subprocess.DEVNULL)
    r = json.load(open(f'/tmp/sym_{tag}_result.json'))
    fr = np.fromfile(f'/tmp/sym_{tag}_frames.bin').reshape(-1, r['stride'])
    return r, fr
rf, ff = run(full, 'full'); rh, fh = run(half, 'half')
Uf = ff[-1, :rf['nd']].reshape(-1, 3)[:28]; Uh = fh[-1, :rh['nd']].reshape(-1, 3)[:28]
E = lambda r: np.array(r['US']) + np.array(r['UF']) + np.array(r['UB'])
print(json.dumps({"U_rel": float(np.abs(Uf - Uh).max() / np.abs(Uf).max()),
                  "energy_full": float(E(rf)[-1]), "energy_half_x2": float(2 * E(rh)[-1]),
                  "incr_full": len(rf['lam']) - 1, "incr_half": len(rh['lam']) - 1}))
