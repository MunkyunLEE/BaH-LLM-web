# BaH-LLM-web

> ## All ideas, equations and algorithms in this project belong to the authors of the papers below
>
> The bar-and-hinge theory, the stiffness formulas, the discretization schemes, the nonlinear solvers, and the elasto-plastic, curved-crease and kirigami extensions all come from these papers and from the MERLIN / MERLIN2 MATLAB code. The author of this repository is **only an implementer** who ported that work to C++ and WebAssembly so that it runs in a browser, and makes no theoretical contribution. If you use results from this tool, please cite the original papers.
>
> 1. **E. T. Filipov, K. Liu, T. Tachi, M. Schenk, G. H. Paulino** (2017). Bar and hinge models for scalable analysis of origami. *International Journal of Solids and Structures* 124, 26–45. https://doi.org/10.1016/j.ijsolstr.2017.05.028
> 2. **K. Liu, G. H. Paulino** (2016). MERLIN: A MATLAB implementation to capture highly nonlinear behavior of non-rigid origami. *Proceedings of the IASS Annual Symposium 2016*, Tokyo.
> 3. **K. Liu, G. H. Paulino** (2018). Highly efficient nonlinear structural analysis of origami assemblages using the MERLIN2 software. *Origami⁷* (7th International Meeting on Origami in Science, Mathematics and Education). The MERLIN2 v1.1 MATLAB code is the reference for this implementation.
> 4. **Y. Tang, Y. Chu, Y. Mei, Y. Zhu, K. Liu** (2026). Bar-and-hinge model for elasto-plastic origami analysis. *Proceedings of the Royal Society A* 482: 20251119. https://doi.org/10.1098/rspa.2025.1119
> 5. **S. R. Woodruff, E. T. Filipov** (2020). A bar and hinge model formulation for structural analysis of curved-crease origami. *International Journal of Solids and Structures* 204–205, 114–127. https://doi.org/10.1016/j.ijsolstr.2020.08.010
> 6. **R. P. Khawale, E. Mehdizadeh, J. Brigham, E. T. Filipov** (2026). Rapid kirigami simulation using the bar & hinge approach. *International Journal of Mechanical Sciences* 329, 112107. https://doi.org/10.1016/j.ijmecsci.2026.112107
>
> Sources of other methods used
> - Arc-length MGDCM: S. E. Leon, E. N. Lages, C. N. de Araújo, G. H. Paulino (2014). On the effect of constraint parameters on the generalized displacement control method. *Mechanics Research Communications* 56, 123–129.
> - Geometric contact (barrier energy, continuous collision detection): M. Li et al. (2020). Incremental Potential Contact. *ACM Transactions on Graphics* 39(4). Implementation details follow the ipctk library.
> - Counting mechanisms (rank of the constraint matrix, self-stress): S. Pellegrino, C. R. Calladine (1986). Matrix analysis of statically and kinematically indeterminate frameworks. *IJSS* 22(4). / M. Schenk, S. D. Guest (2011). Origami folding: a structural engineering approach. *Origami⁵*.
> - Rigid folding paths: T. Tachi (2009). Simulation of rigid origami. *Origami⁴*.

A bar-and-hinge origami simulator that computes in the browser. The MERLIN2 MATLAB code was ported to C++ and compiled to WebAssembly; everything runs inside the browser (Web Worker), no server. Supports, loads and result plots are given as sentences (rule-based in English or Korean, optionally an OpenAI-compatible LLM). The interface is available in English and Korean (follows the browser language, switch with the EN/KR button).

- Web: https://munkyunlee.github.io/BaH-LLM-web/
- Equations and verification: the **Theory** button in the app (`web/theory.html`)

## Analyses

| Analysis | Description |
|---|---|
| Static (prescribed displacement) | MERLIN2 Displacement scheme, damped Newton |
| Arc-length (MGDCM) | Forces, pressure, gravity; reactions at loaded nodes and the load factor |
| Modal | Eigenvalues of the stiffness matrix K alone (no mass), or K φ = ω² M φ (lumped mass) |
| Degrees of freedom | Rank of the rigid-panel constraint Jacobian → mechanisms and self-stress states (shown in every result summary) |
| Kinematics (rigid folding) | Folding path driving creases to target dihedral angles; mechanism modes when there are no drivers |
| Solution space | 3D plot of the dihedral angles of three chosen creases (bundle of rigid folding paths + the analysis path) |

Also: mirror symmetry, pressure (Global / Local follower), geometric contact, elasto-plasticity (Tang 2026), cyclic loading, initial imperfection, curved-crease and kirigami stiffness formulas. Default contours follow MERLIN2 (sum of bar forces per node, bar stress per bar).

## Example sentences

`fix the bottom` · `fix node 8` · `move node 59 by -30 mm in y` · `pressure 0.001 MPa downward on top` · `symmetry x = 0` · `arc-length` · `stiffness modes 6` · `dof analysis` · `drive crease 2-7 to 120 deg` · `solution space of creases 2-7, 7-12, 6-7` · `node 59 force-displacement plot` · `run` · `help`

## Running locally

- `./run.sh` → open `http://localhost:8766/index.html` (WASM cannot be loaded from `file://`, so a small local server is needed)

## Layout

- `core/` C++17 solver core (Eigen, float64)
  - `model.cpp` MERLIN2 `PrepareData` (N5B8/N4B5 discretization, automatic material), mirror symmetry hinges
  - `elem.cpp` MERLIN2 `GlobalK_fast_ver` (bar and hinge forces and stiffness), Tang 2026 elasto-plasticity, pressure
  - `solver.cpp` MERLIN2 `PathAnalysis` (MGDCM, prescribed displacement), modal, DOF, kinematic path, solution space
  - `contact.cpp` geometric contact (IPC barrier, continuous collision detection)
  - `api.cpp` JSON input/output (shared by WASM and the CLI)
  - Build: `make native` (test CLI `build/bhcli`), `make wasm` (`web/bh.wasm`, needs `pip install ziglang`)
- `web/` UI, `backend.js` (spec, edit operations, results), `rules.js` + `rules_vocab.js` (sentence rules and their vocabulary in Korean and English), `i18n.js` + `i18n_en.js` (UI language), `llm.js`, `worker.js`
- `tests/merlin/` comparison with MERLIN2 run in Octave (`python3 cases.py cmp`), `tests/feature/` symmetry and contact tests, `tests/web/rules_regress.mjs` sentence rules (Korean and English)
- `reference/python/` earlier Python implementation (reference only)

## Units

mm · N · tonne · s · MPa. Node numbers follow the OBJ order starting at 1 (the on-screen #numbers, same as MERLIN2). Creases are named by their end nodes, e.g. "crease 2-7".

## Original works

The paper PDFs and the MERLIN2 MATLAB source are not included in this repository for copyright reasons. Please obtain them from the publishers and authors.

---

## 한국어 안내

> **이 프로젝트의 아이디어·수식·알고리즘은 모두 위 논문 저자들의 것입니다.** 이 저장소의 작성자는 그 내용을 C++ 와 WebAssembly 로 옮겨 브라우저에서 돌아가게 만든 구현자일 뿐이며, 이론적 기여는 없습니다. 결과를 발표할 때는 반드시 원 논문을 인용해 주십시오.

브라우저에서 바로 계산하는 바-힌지 오리가미 시뮬레이터입니다. MERLIN2 MATLAB 코드를 C++ 로 옮겨 WebAssembly 로 빌드했고, 서버 없이 브라우저 안에서 계산합니다. 경계·하중 조건과 결과 그래프는 한국어나 영어 문장으로 지시합니다. 화면 언어는 브라우저 언어를 따르며 (한국어가 아니면 영어), 왼쪽 위 EN/KR 버튼으로 바꿀 수 있습니다. 수식과 검증은 앱의 Theory 버튼에서 볼 수 있습니다.
