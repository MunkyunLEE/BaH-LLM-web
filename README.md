# BaH-LLM-web

브라우저에서 바로 계산하는 바-힌지(bar-and-hinge) 오리가미 시뮬레이터입니다. MERLIN2 (Liu & Paulino 2018) 의 MATLAB 코드를 C++ 로 옮겨 WebAssembly 로 빌드했고, 서버 없이 브라우저 안(Web Worker)에서 계산합니다. 경계·하중 조건은 문장으로 넣습니다 (규칙 기반, 선택적으로 OpenAI 호환 LLM).

## 실행

- 웹: GitHub Pages (저장소 Settings → Pages → Source: GitHub Actions)
- 로컬: `./run.sh` → 브라우저에서 `http://localhost:8766/index.html` (WASM 은 파일을 더블클릭해 여는 `file://` 로는 불러올 수 없어 간단한 로컬 서버가 필요합니다)

## 구성

- `core/` C++17 계산 코어 (Eigen, float64)
  - `model.cpp` MERLIN2 `PrepareData` (N5B8/N4B5 이산화, 재료 자동 산정), 미러 대칭 힌지
  - `elem.cpp` MERLIN2 `GlobalK_fast_ver` (바·힌지 내력·강성), Tang 2026 탄소성, 압력
  - `solver.cpp` MERLIN2 `PathAnalysis` (MGDCM, 강제 변위), 모달, 기구 해석
  - `contact.cpp` 기하 접촉 (IPC 장벽, 연속 충돌 검사)
  - `api.cpp` JSON 입출력 (WASM·CLI 공용)
  - 빌드: `make native` (시험용 CLI `build/bhcli`), `make wasm` (`web/bh.wasm`, `pip install ziglang` 필요)
- `web/` 화면 (FEM-LLM-web 형식), `backend.js` (스펙·수정 지시·결과), `rules.js` (문장 규칙), `llm.js`, `worker.js`
- `tests/merlin/` MERLIN2 를 Octave 로 돌린 정답 데이터와 비교 (`python3 cases.py cmp`)
- `reference/python/` 이전 Python 구현 (참조용)
- 수식 대장과 검증 결과: `web/docs/equations.md`, `web/docs/verification.md` (앱의 Theory 버튼)

## 단위

mm · N · tonne · s · MPa. 절점 번호는 OBJ 순서 1부터 (화면 #번호, MERLIN2 와 같음).

## 참고 문헌

- E. T. Filipov, K. Liu, T. Tachi, M. Schenk, G. H. Paulino (2017) Bar and hinge models for scalable analysis of origami. IJSS 124
- K. Liu, G. H. Paulino (2016) MERLIN. IASS / (2018) MERLIN2. Origami⁷
- Y. Tang 외 (2026) Bar-and-hinge model for elasto-plastic origami analysis. Proc. R. Soc. A 482
- S. R. Woodruff, E. T. Filipov (2020) Curved-crease origami bar and hinge. IJSS 204
- R. P. Khawale 외 (2026) Kirigami bar and hinge. IJMS 329
