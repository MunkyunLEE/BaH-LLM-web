# BaH-LLM-web

> ## 이 프로젝트의 아이디어·수식·알고리즘은 모두 아래 논문 저자들의 것입니다
>
> 바-힌지(bar-and-hinge) 모델의 이론, 재료 산정 식, 이산화 방식, 비선형 풀이법, 탄소성·곡선 주름·키리가미 확장은 전부 아래 논문과 MERLIN / MERLIN2 MATLAB 코드에서 왔습니다. 이 저장소의 작성자는 그 내용을 C++ 와 WebAssembly 로 옮겨 브라우저에서 돌아가게 만든 **구현자일 뿐**이며, 이론적 기여는 없습니다. 이 도구로 얻은 결과를 발표할 때는 반드시 원 논문을 인용해 주십시오.
>
> 1. **E. T. Filipov, K. Liu, T. Tachi, M. Schenk, G. H. Paulino** (2017). Bar and hinge models for scalable analysis of origami. *International Journal of Solids and Structures* 124, 26–45. https://doi.org/10.1016/j.ijsolstr.2017.05.028
> 2. **K. Liu, G. H. Paulino** (2016). MERLIN: A MATLAB implementation to capture highly nonlinear behavior of non-rigid origami. *Proceedings of the IASS Annual Symposium 2016*, Tokyo.
> 3. **K. Liu, G. H. Paulino** (2018). Highly efficient nonlinear structural analysis of origami assemblages using the MERLIN2 software. *Origami⁷* (7th International Meeting on Origami in Science, Mathematics and Education). — MERLIN2 v1.1 MATLAB 코드가 이 구현의 정답 기준입니다.
> 4. **Y. Tang, Y. Chu, Y. Mei, Y. Zhu, K. Liu** (2026). Bar-and-hinge model for elasto-plastic origami analysis. *Proceedings of the Royal Society A* 482: 20251119. https://doi.org/10.1098/rspa.2025.1119
> 5. **S. R. Woodruff, E. T. Filipov** (2020). A bar and hinge model formulation for structural analysis of curved-crease origami. *International Journal of Solids and Structures* 204–205, 114–127. https://doi.org/10.1016/j.ijsolstr.2020.08.010
> 6. **R. P. Khawale, E. Mehdizadeh, J. Brigham, E. T. Filipov** (2026). Rapid kirigami simulation using the bar & hinge approach. *International Journal of Mechanical Sciences* 329, 112107. https://doi.org/10.1016/j.ijmecsci.2026.112107
>
> 함께 쓴 방법의 출처
> - 호장법 MGDCM: S. E. Leon, E. N. Lages, C. N. de Araújo, G. H. Paulino (2014). On the effect of constraint parameters on the generalized displacement control method. *Mechanics Research Communications* 56, 123–129.
> - 기하 접촉 (장벽 에너지, 연속 충돌 검사): M. Li 외 (2020). Incremental Potential Contact. *ACM Transactions on Graphics* 39(4). 구현 세부는 ipctk 라이브러리와 같게 맞췄습니다.
> - 자유도 계산 (구속 행렬의 계수, 자기 응력): S. Pellegrino, C. R. Calladine (1986). Matrix analysis of statically and kinematically indeterminate frameworks. *IJSS* 22(4). / M. Schenk, S. D. Guest (2011). Origami folding: a structural engineering approach. *Origami⁵*.
> - 강체 접힘 경로: T. Tachi (2009). Simulation of rigid origami. *Origami⁴*.

브라우저에서 바로 계산하는 바-힌지 오리가미 시뮬레이터입니다. MERLIN2 의 MATLAB 코드를 C++ 로 옮겨 WebAssembly 로 빌드했고, 서버 없이 브라우저 안(Web Worker)에서 계산합니다. 경계·하중 조건과 결과 그래프는 문장으로 지시합니다 (규칙 기반, 선택적으로 OpenAI 호환 LLM).

- 웹: https://munkyunlee.github.io/BaH-LLM-web/
- 수식과 검증: 앱의 **Theory** 버튼 (`web/theory.html`)

## 할 수 있는 해석

| 해석 | 내용 |
|---|---|
| 정적 (강제 변위) | MERLIN2 Displacement 방식 감쇠 뉴턴 |
| 호장법 (MGDCM) | 힘·압력·자중 하중, 하중점 반력과 하중 계수 |
| 모달 | 강성 행렬 K 만의 고유값 (질량 없음) 또는 K φ = ω² M φ (집중 질량) |
| 자유도 | 강체 패널 구속 야코비안의 계수 → 기구 자유도, 자기 응력 상태 (모든 결과 요약에 표시) |
| 기구 (강체 접힘) | 구동 주름을 목표 이면각까지 돌린 접힘 경로, 구동 주름이 없으면 기구 모드 |
| 해 공간 | 고른 주름 3개의 이면각 3차원 그래프 (강체 접힘 경로 다발 + 해석 경로) |

부가 기능: 미러 대칭, 압력 (Global / Local follower), 기하 접촉, 탄소성 (Tang 2026), 반복 하중, 초기 결함, 곡선 주름·키리가미 강성식.

## 실행

- 로컬: `./run.sh` → 브라우저에서 `http://localhost:8766/index.html` (WASM 은 `file://` 로 열 수 없어 간단한 로컬 서버가 필요합니다)

## 구성

- `core/` C++17 계산 코어 (Eigen, float64)
  - `model.cpp` MERLIN2 `PrepareData` (N5B8/N4B5 이산화, 재료 자동 산정), 미러 대칭 힌지
  - `elem.cpp` MERLIN2 `GlobalK_fast_ver` (바·힌지 내력·강성), Tang 2026 탄소성, 압력
  - `solver.cpp` MERLIN2 `PathAnalysis` (MGDCM, 강제 변위), 모달, 자유도, 기구 경로, 해 공간
  - `contact.cpp` 기하 접촉 (IPC 장벽, 연속 충돌 검사)
  - `api.cpp` JSON 입출력 (WASM·CLI 공용)
  - 빌드: `make native` (시험용 CLI `build/bhcli`), `make wasm` (`web/bh.wasm`, `pip install ziglang` 필요)
- `web/` 화면, `backend.js` (스펙·수정 지시·결과), `rules.js` (문장 규칙), `llm.js`, `worker.js`
- `tests/merlin/` MERLIN2 를 Octave 로 돌린 정답 데이터와 비교 (`python3 cases.py cmp`), `tests/feature/` 대칭·접촉 시험
- `reference/python/` 이전 Python 구현 (참조용)

## 단위

mm · N · tonne · s · MPa. 절점 번호는 OBJ 순서 1부터 (화면 #번호, MERLIN2 와 같음). 주름은 양 끝 절점 번호로 "2-7 주름" 처럼 부릅니다.

## 원 저작물

논문 PDF 와 MERLIN2 MATLAB 원본은 저작권 때문에 이 저장소에 올리지 않았습니다. 원본은 각 출판사와 저자에게서 받으십시오.
