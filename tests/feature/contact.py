import json, subprocess, numpy as np, os, math
HERE = os.path.dirname(os.path.abspath(__file__))
CLI = os.path.join(HERE, '..', '..', 'core', 'build', 'bhcli')
c, h = 10 - 10 / math.sqrt(2), 10 / math.sqrt(2)
base = {"nodes": [[0, 0, 0], [10, 0, 0], [10, 10, 0], [0, 10, 0], [c, 10, h], [c, 0, h]],
        "panels": [[0, 1, 2, 3], [1, 5, 4, 2]],
        "options": {"E": 1000, "nu": 0.3, "t": 0.2, "Lratio": 3},
        "supports": [[i, 1, 1, 1] for i in range(4)]}
cases = {
    "force_contact": dict(base, forces=[[5, 0, 0, -1], [4, 0, 0, -1]], analysis={"type": "force", "maxIcr": 300, "lamMax": 2, "contact": True, "gap": 0.2}),
    "force_free": dict(base, forces=[[5, 0, 0, -1], [4, 0, 0, -1]], analysis={"type": "force", "maxIcr": 300, "lamMax": 2, "contact": False}),
    "disp_blocked": dict(base, displacements=[[4, None, None, -8], [5, None, None, -8]], analysis={"type": "displacement", "dispStep": 40, "contact": True, "gap": 0.2}),
}
out = {}
for tag, spec in cases.items():
    json.dump(spec, open(f'/tmp/ct_{tag}.json', 'w'))
    subprocess.run([CLI, f'/tmp/ct_{tag}.json', f'/tmp/ct_{tag}'], check=True, stderr=subprocess.DEVNULL, timeout=120)
    r = json.load(open(f'/tmp/ct_{tag}_result.json'))
    X = np.array(json.load(open(f'/tmp/ct_{tag}_model.json'))['nodes'])
    fr = np.fromfile(f'/tmp/ct_{tag}_frames.bin').reshape(-1, r['stride'])
    zmin = min(float((X + f[:r['nd']].reshape(-1, 3))[4:6, 2].min()) for f in fr)
    md = [d for d in r['minDist'] if d >= 0]
    out[tag] = {"status": r['status'], "frames": len(fr), "flap_zmin": zmin, "minDist": min(md) if md else None, "lam": r['lam'][-1]}
ok = out["force_contact"]["minDist"] >= 0.2 - 1e-9 and out["force_free"]["flap_zmin"] < 0 and out["disp_blocked"]["status"] == "contact_blocked" and out["disp_blocked"]["minDist"] >= 0.2 - 1e-9
print(json.dumps(out, indent=1))
print("OK" if ok else "FAIL")
