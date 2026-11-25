import json
import math
import os

HERE = os.path.dirname(os.path.abspath(__file__))


def write_obj(name, V, F, lines=()):
    with open(os.path.join(HERE, name), "w") as f:
        f.write("# BaH-LLM-web example\n")
        for v in V:
            f.write("v %.10g %.10g %.10g\n" % tuple(v))
        for l in lines:
            f.write("l %d %d\n" % (l[0] + 1, l[1] + 1))
        for p in F:
            f.write("f " + " ".join(str(i + 1) for i in p) + "\n")


def miura(xd, yd, theta, a, b, gamma):
    th = math.radians(theta)
    g = math.radians(gamma)
    nx, ny = 2 * xd, 2 * yd
    h = a * math.sin(th) * math.sin(g)
    s = b * math.cos(g) * math.tan(th) / math.sqrt(1 + math.cos(g) ** 2 * math.tan(th) ** 2)
    l = a * math.sqrt(1 - math.sin(g) ** 2 * math.sin(th) ** 2)
    v = b / math.sqrt(1 + math.cos(g) ** 2 * math.tan(th) ** 2)
    V = []
    for i in range(nx + 1):
        for j in range(ny + 1):
            V.append([s * i, l * j + (v if i % 2 else 0.0), h if j % 2 else 0.0])
    F = []
    for j in range(ny):
        for i in range(nx):
            n1 = i * (ny + 1) + j
            n2 = (i + 1) * (ny + 1) + j
            F.append([n1, n2, n2 + 1, n1 + 1])
    return V, F, nx, ny


def kresling(n=6, a=40.0, h=30.0, phi=11 * math.pi / 18):
    R = a / (2 * math.sin(math.pi / n))
    V = [[R * math.cos(2 * math.pi * i / n), R * math.sin(2 * math.pi * i / n), 0.0] for i in range(n)]
    V += [[R * math.cos(2 * math.pi * i / n + phi), R * math.sin(2 * math.pi * i / n + phi), h] for i in range(n)]
    F = []
    for i in range(n):
        b0, b1 = i, (i + 1) % n
        t0, t1 = n + i, n + (i + 1) % n
        F += [[b0, b1, t0], [b1, t1, t0]]
    return V, F


def grid(Lx, Ly, nx, ny, tri=False):
    V = [[Lx * i / nx, Ly * j / ny, 0.0] for i in range(nx + 1) for j in range(ny + 1)]
    F = []
    for i in range(nx):
        for j in range(ny):
            a = i * (ny + 1) + j
            b = (i + 1) * (ny + 1) + j
            if tri:
                F += [[a, b, b + 1], [a, b + 1, a + 1]] if (i + j) % 2 == 0 else [[a, b, a + 1], [b, b + 1, a + 1]]
            else:
                F.append([a, b, b + 1, a + 1])
    return V, F


P = {}

V, F, nx, ny = miura(3, 3, 60, 20, 20, 60)
write_obj("miura_3x3.obj", V, F)
left = [j for j in range(ny + 1)]
P["miura_fold"] = {
    "title": "1. 미우라 3x3 접기 (강제 변위, N5B8 자동 강성)",
    "file": "miura_3x3.obj",
    "note": "x 최소 변을 x 고정, 한 점을 완전 고정, x 최대 변을 x 방향으로 -15 mm 밀어 접습니다. MERLIN2 강제 변위 방식(감쇠 뉴턴).",
    "prompts": ["x 최대 변을 x 방향으로 -15 mm", "1번 점 변위-힘 그래프", "접힘 에너지 그래프", "해석 실행"],
    "ops": [
        {"op": "set_material", "E": 1000, "nu": 0.3, "thickness": 0.25, "rho": 1e-9},
        {"op": "add_bc", "select": {"plane": {"axis": "x", "at": "min"}}, "dofs": [1], "name": "x 최소 변 x 구속"},
        {"op": "add_bc", "select": {"nodes": [0]}, "type": "fixed", "name": "기준점 고정"},
        {"op": "add_bc", "select": {"nodes": [ny]}, "dofs": [3], "name": "z 구속"},
        {"op": "add_bc", "select": {"plane": {"axis": "x", "at": "max"}}, "dofs": [1], "value": -15.0, "name": "강제 변위"},
        {"op": "set_step", "type": "static", "increments": 100},
    ],
}

hexv = [[0, 0, 0], [0, 20, 0], [24, 30, 0], [60, 20, 0], [60, 0, 0], [36, -10, 0]]
write_obj("hexagon.obj", hexv, [[0, 1, 2, 3, 4, 5]])
P["hexagon_twist"] = {
    "title": "2. 육각형 패널 비틀기 (MERLIN2 PolygonTest, 호장법)",
    "file": "hexagon.obj",
    "note": "MERLIN2 PolygonTest 와 같은 조건: 마일라 E 5 GPa, ν 0.35, t 0.127. 5번 점에 -z 1 N, 호장법(MGDCM). 5번 점 z 변위 12 mm 에서 정지.",
    "prompts": ["5번 점 변위-힘 그래프", "해석 실행"],
    "ops": [
        {"op": "set_material", "E": 5000, "nu": 0.35, "thickness": 0.127},
        {"op": "add_bc", "select": {"nodes": [0]}, "type": "fixed"},
        {"op": "add_bc", "select": {"nodes": [1]}, "dofs": [1, 3]},
        {"op": "add_bc", "select": {"nodes": [3]}, "dofs": [3]},
        {"op": "add_load", "type": "force", "select": {"nodes": [4]}, "vector": [0, 0, -1]},
        {"op": "set_step", "type": "arclength", "increments": 100, "lambda0": 1e-5, "lam_max": None, "stop": [{"node": 4, "dir": 2, "value": 12}]},
    ],
}

V, F = kresling()
write_obj("kresling.obj", V, F)
P["kresling_cycle"] = {
    "title": "3. 크레슬링 1단 반복 압축 (소성 힌지, Tang 2026)",
    "file": "kresling.obj",
    "note": "아래 링 고정, 위 링을 z 방향으로 -12 mm 눌렀다 되돌리기 3회. 알루미늄 두께 0.3, 접힘 힌지 탄소성 (길이당 항복 모멘트 0.05 N·mm/mm, 경화 0.05, Tang 2026 처럼 주름선을 따로 보정한 값).",
    "prompts": ["해석 실행", "에너지 그래프", "7번 점 변위-힘 그래프"],
    "ops": [
        {"op": "set_material", "E": 70000, "nu": 0.33, "thickness": 0.3, "yield": 250},
        {"op": "set_bh", "plastic_hinge": True, "fold_yield": 0.05, "fold_H": 0.05, "cycles": 3},
        {"op": "add_bc", "select": {"plane": {"axis": "z", "at": "min"}}, "type": "fixed"},
        {"op": "add_bc", "select": {"plane": {"axis": "z", "at": "max"}}, "dofs": [3], "value": -12.0},
        {"op": "set_step", "type": "static", "increments": 60},
    ],
}

fold = [[100, 0, 0], [100, 200, 0], [200, 100, 0], [0, 100, 0]]
write_obj("simple_fold.obj", fold, [[0, 2, 1], [0, 1, 3]])
P["simple_fold"] = {
    "title": "4. 단일 주름 접기 (Tang 2026 그림 4 형상)",
    "file": "simple_fold.obj",
    "note": "삼각형 ABC 고정, D 점을 z 방향으로 들어 올려 주름 AB 를 접습니다. 알루미늄, 소성 힌지.",
    "prompts": ["4번 점 변위-힘 그래프", "해석 실행"],
    "ops": [
        {"op": "set_material", "E": 67000, "nu": 0.33, "thickness": 1.0, "yield": 250},
        {"op": "set_bh", "plastic_hinge": True, "fold_yield": 2.0, "fold_H": 5.0},
        {"op": "add_bc", "select": {"nodes": [0, 1, 2]}, "type": "fixed"},
        {"op": "add_bc", "select": {"nodes": [3]}, "dofs": [3], "value": 60.0},
        {"op": "set_step", "type": "static", "increments": 100},
    ],
}

V, F, nx, ny = miura(2, 2, 80, 20, 20, 55)
write_obj("miura_flat.obj", V, F)
P["miura_modal"] = {
    "title": "5. 미우라 자유-자유 모달 (질량 포함)",
    "file": "miura_flat.obj",
    "note": "구속 없이 고유진동 해석. 강체 모드 6개 다음에 접힘 모드가 나옵니다 (Filipov 2017 그림 11 의 경향).",
    "prompts": ["해석 실행", "모드 10개"],
    "ops": [
        {"op": "set_material", "E": 3000, "nu": 0.3, "thickness": 0.5, "rho": 1.2e-9},
        {"op": "set_step", "type": "modal", "modes": 10},
    ],
}

V, F, nx, ny = miura(3, 2, 60, 20, 20, 60)
half = [k for k in range(len(F)) if (k % nx) < nx // 2]
used = sorted({v for k in half for v in F[k]})
mp = {o: i for i, o in enumerate(used)}
Vh = [V[o] for o in used]
Fh = [[mp[v] for v in F[k]] for k in half]
xc = V[(nx // 2) * (ny + 1)][0]
write_obj("miura_half.obj", Vh, Fh)
top = max(range(len(Vh)), key=lambda k: (abs(Vh[k][0] - xc) < 1e-9, Vh[k][1]))
P["miura_symmetry"] = {
    "title": "6. 미우라 반 모델 + x 대칭면 (미러 조건)",
    "file": "miura_half.obj",
    "note": "전체 6x4 미우라의 왼쪽 반만 모델링하고 x 최대 변을 대칭면으로 둡니다. x 최소 변 고정, 대칭면 위 맨 위 점을 아래로 4 mm. 대칭 표시를 켜면 나머지 반을 비춰 그립니다.",
    "prompts": ["대칭 표시 꺼", "해석 실행"],
    "ops": [
        {"op": "set_material", "E": 1000, "nu": 0.3, "thickness": 1.0},
        {"op": "add_symmetry", "axis": "x", "at": xc},
        {"op": "add_bc", "select": {"plane": {"axis": "x", "at": "min"}}, "type": "fixed"},
        {"op": "add_bc", "select": {"nodes": [top]}, "dofs": [3], "value": -4.0},
        {"op": "set_step", "type": "static", "increments": 40},
    ],
}

V, F = grid(120, 120, 6, 6)
for i in range(7):
    for j in range(7):
        V[i * 7 + j][2] = 8.0 if i % 2 else 0.0
lines = []
for i in range(1, 6):
    for j in range(6):
        lines.append((i * 7 + j, i * 7 + j + 1))
write_obj("corrugated.obj", V, F, lines)
P["pressure_sheet"] = {
    "title": "7. 주름진 판에 압력 (Local 법선 하중, 호장법)",
    "file": "corrugated.obj",
    "note": "x 방향 주름 판 (l 선 = 접힘). x 양 끝 변 고정, 전체 면에 0.0005 MPa 압력을 면 법선 방향(Local)으로. 화살표 방향은 면 꼭짓점 순서로 정해지고 '방향 뒤집기'로 바꿀 수 있습니다.",
    "prompts": ["ld1 2배", "전체 면에 아래로 압력 0.0005 MPa", "해석 실행"],
    "ops": [
        {"op": "set_material", "E": 3000, "nu": 0.3, "thickness": 0.5},
        {"op": "add_bc", "select": {"or": [{"plane": {"axis": "x", "at": "min"}}, {"plane": {"axis": "x", "at": "max"}}]}, "type": "fixed"},
        {"op": "add_load", "type": "pressure", "select": {"all": True}, "value": 0.0005, "mode": "local"},
        {"op": "set_step", "type": "arclength", "increments": 60},
    ],
}

nxk, nyk = 12, 6
V, F = grid(120, 60, nxk, nyk, tri=True)
cut = [(i * (nyk + 1) + 3, (i + 1) * (nyk + 1) + 3) for i in range(4, 8)]
write_obj("kirigami_slit.obj", V, F)
P["kirigami_slit"] = {
    "title": "8. 키리가미 슬릿 판 인장 (Khawale 2026 강성, 자름)",
    "file": "kirigami_slit.obj",
    "note": "내부 엣지는 모두 '휨', 가운데 슬릿 4칸은 '자름', 삼각형 메쉬 강성은 Khawale (F_s 0.85, F_B 0.125). x 최소 변 고정, x 최대 변을 x 방향으로 6 mm 당깁니다. 초기 결함 0.01 mm.",
    "prompts": ["해석 실행", "에너지 그래프"],
    "ops": [
        {"op": "set_material", "E": 3000, "nu": 0.3, "thickness": 0.3},
        {"op": "set_bh", "tri_bars": "khawale", "edge_bend": "khawale"},
        {"op": "set_crease", "edges": "all", "type": "bend"},
        {"op": "set_crease", "edges": [list(e) for e in cut], "type": "cut"},
        {"op": "add_bc", "select": {"plane": {"axis": "x", "at": "min"}}, "type": "fixed"},
        {"op": "add_bc", "select": {"plane": {"axis": "x", "at": "max"}}, "dofs": [1], "value": 6.0},
        {"op": "add_bc", "select": {"plane": {"axis": "x", "at": "max"}}, "dofs": [2, 3]},
        {"op": "set_step", "type": "static", "increments": 60, "imperfection": 0.01},
    ],
}

V, F, nx, ny = miura(2, 2, 70, 20, 20, 60)
write_obj("miura_kin.obj", V, F)
P["miura_kinematic"] = {
    "title": "9. 미우라 강체 접힘 기구 해석",
    "file": "miura_kin.obj",
    "note": "패널 강체 가정. 구동 주름 하나를 목표 이면각으로 돌려 접힘 경로를 계산합니다 (기구 자유도 1).",
    "prompts": ["해석 실행"],
    "ops": [
        {"op": "set_material", "E": 3000, "nu": 0.3, "thickness": 0.5},
        {"op": "set_bh", "drivers": [[1, 6]], "targets": [120]},
        {"op": "set_step", "type": "kinematic", "increments": 60},
    ],
}

Lc = 40.0
cx, cz = Lc - Lc / math.sqrt(2), Lc / math.sqrt(2)
write_obj("flap_contact.obj", [[0, 0, 0], [Lc, 0, 0], [Lc, Lc, 0], [0, Lc, 0], [cx, Lc, cz], [cx, 0, cz]], [[0, 1, 2, 3], [1, 5, 4, 2]])
P["flap_contact"] = {
    "title": "10. 날개 판이 바닥 판 위로 접히며 접촉 (기하 접촉, 호장법)",
    "file": "flap_contact.obj",
    "note": "바닥 판 네 꼭짓점 고정, 45° 로 선 날개 판 끝 변(5, 6번 점)에 아래로 힘. 접촉 간격 0.5 mm 로 날개가 바닥을 뚫지 않고 멈춥니다. 닿은 뒤에는 강성이 커져 MGDCM 하중 계수가 크게 뜁니다.",
    "prompts": ["접촉 에너지 그래프", "5번 점 변위-힘 그래프", "해석 실행"],
    "ops": [
        {"op": "set_material", "E": 3000, "nu": 0.3, "thickness": 0.5},
        {"op": "add_bc", "select": {"nodes": [0, 1, 2, 3]}, "type": "fixed", "name": "바닥 판 고정"},
        {"op": "add_load", "type": "force", "select": {"nodes": [4, 5]}, "vector": [0, 0, -1]},
        {"op": "set_bh", "contact": True, "gap": 0.5},
        {"op": "set_step", "type": "arclength", "increments": 200, "lambda0": 0.002, "lam_max": 2},
    ],
}

EN = {
    "miura_fold": ("1. Miura 3x3 folding (prescribed displacement, N5B8 auto stiffness)",
                   "x min edge constrained in x, one node fully fixed, x max edge pushed -15 mm in x to fold. MERLIN2 displacement loading (damped Newton).",
                   ["move x max edge by -15 mm in x", "node 1 force-displacement plot", "fold energy plot", "run"]),
    "hexagon_twist": ("2. Hexagonal panel twist (MERLIN2 PolygonTest, arc-length)",
                      "Same as MERLIN2 PolygonTest: Mylar E 5 GPa, ν 0.35, t 0.127. Node 5 loaded with -z 1 N, arc-length (MGDCM). Stops at 12 mm z displacement of node 5.",
                      ["node 5 force-displacement plot", "run"]),
    "kresling_cycle": ("3. Single Kresling, cyclic compression (plastic hinges, Tang 2026)",
                       "Bottom ring fixed, top ring pushed -12 mm in z and returned, 3 cycles. Aluminum, thickness 0.3, elasto-plastic fold hinges (yield moment 0.05 N·mm/mm per length, hardening 0.05, calibrated along creases as in Tang 2026).",
                       ["run", "energy plot", "node 7 force-displacement plot"]),
    "simple_fold": ("4. Single crease fold (geometry of Tang 2026 Fig. 4)",
                    "Triangle ABC fixed, point D lifted in z to fold crease AB. Aluminum, plastic hinge.",
                    ["node 4 force-displacement plot", "run"]),
    "miura_modal": ("5. Miura free-free modal (with mass)",
                    "Eigen analysis without supports. Six rigid-body modes come first, then folding modes (trend of Filipov 2017 Fig. 11).",
                    ["run", "10 modes"]),
    "miura_symmetry": ("6. Half Miura + x symmetry plane (mirror condition)",
                       "Only the left half of a 6x4 Miura is modelled; the x max edge is the symmetry plane. x min edge fixed, the top node on the plane pushed 4 mm down. Turn on mirror display to draw the other half.",
                       ["hide mirror", "run"]),
    "pressure_sheet": ("7. Pressure on a corrugated sheet (Local normal load, arc-length)",
                       "Corrugated sheet in x (l lines = folds). Both x ends fixed, 0.0005 MPa pressure on all faces along the face normal (Local). Arrow direction follows the face vertex order and can be changed with 'Flip direction'.",
                       ["ld1 x2", "pressure 0.0005 MPa downward on all faces", "run"]),
    "kirigami_slit": ("8. Kirigami slit sheet in tension (Khawale 2026 stiffness, cuts)",
                      "All interior edges 'bend', four middle slits 'cut', triangle mesh stiffness by Khawale (F_s 0.85, F_B 0.125). x min edge fixed, x max edge pulled 6 mm in x. Initial imperfection 0.01 mm.",
                      ["run", "energy plot"]),
    "miura_kinematic": ("9. Miura rigid folding (kinematic analysis)",
                        "Rigid panels. One driver crease is rotated to a target dihedral angle to trace the folding path (1 mechanism).",
                        ["run", "solution space of creases 2-7, 7-12, 6-7"]),
    "flap_contact": ("10. Flap folding onto a base plate (geometric contact, arc-length)",
                     "Four corners of the base plate fixed, downward force on the free edge (nodes 5, 6) of a flap standing at 45°. With a 0.5 mm contact gap the flap stops without passing through the plate. After contact the stiffness rises, so the MGDCM load factor jumps.",
                     ["contact energy plot", "node 5 force-displacement plot", "run"]),
}
for k, (t, n, pr) in EN.items():
    if k in P:
        P[k]["title_en"], P[k]["note_en"], P[k]["prompts_en"] = t, n, pr

json.dump(P, open(os.path.join(HERE, "presets.json"), "w"), ensure_ascii=False, indent=1)
print("examples", list(P))
