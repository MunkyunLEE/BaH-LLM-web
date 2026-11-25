# BaH-LLM-web 개발 안내 (Claude Code 용)

브라우저 WASM 으로 계산하는 바-힌지 오리가미 시뮬레이터. 정답 기준은 MERLIN2 v1.1 MATLAB 코드.

## 사용자와 작업 방식
- 사용자는 CAE 엔지니어 (도쿄대 다치 연구실 오리가미 박사, Abaqus 로 별도 검증). 대화·화면 문구는 한국어 존댓말
- 코드에 주석을 달지 않음. 큰 파일은 통째로 다시 쓰지 말고 필요한 곳만 수정
- 수식과 MATLAB 코드를 정확히 옮기는 것이 최우선. 논문 그림 재현은 경향이 맞으면 넘어가고, 불일치는 보고
- MERLIN2 와 다른 점은 `web/docs/equations.md` 8절에 적고, `compat` 옵션으로 MERLIN2 그대로도 재현
- 진행 중간에 화면을 캡처해 보여 줌 (`tools/shot.py`, 헤드리스 Chrome)
- 작업이 끝나면 main 에 푸시

## 빌드·시험
- `make -C core native wasm` (wasm 은 `pip install ziglang`, Eigen 은 `/usr/include/eigen3`)
- MERLIN2 대조: `python3 tests/merlin/cases.py cmp` (정답 데이터 `tests/merlin/ref/*.npz`, 다시 만들려면 Octave 와 MERLIN2 폴더를 `MERLIN_DIR` 로 두고 `cases.py ref`)
- 대칭 검증: `python3 tests/feature/symmetry.py`
- 접촉 검증: `python3 tests/feature/contact.py`
- 수치 미분: `core/tools/fdcheck.cpp`
- 문장 규칙: `node tests/web/rules_regress.mjs` (한국어·영어 사례 `rules_cases.json`, 새 한국어 사례는 `record` 로 기록), 자유 탐색 `node tests/web/rules_probe.mjs`
- 예제: `python3 web/examples/make_examples.py` → `web/examples/presets.json`

## 구조 요점
- 스펙 (backend.js `defaultSpec`): materials.default, sections['*'].thickness, bh{...}, creases{"a-b": fold|bend|cut}, bcs (value≠0 = 강제 변위), loads (force/pressure/gravity), symmetry, step, plots
- 해석 종류: static (강제 변위 있으면 MERLIN2 Displacement, 힘만 있으면 MGDCM), arclength, modal, kinematic
- 결과 프레임 = [U(nd), 내력 IF(nd), 절점 에너지 바·접힘·휨(nn×3), 바 응력 Sx(nb), 바 누적 소성 α_bar(nb), 힌지 누적 소성 회전 α_hinge(nh)]. 반력·하중점 힘은 IF 에서. 컨투어 기본은 MERLIN2 Vertex(Σ|Sx·A|), 소성이면 PEEQ 컨투어(peeqBar/peeqFold/peeqBend) 추가
- 해석 뒤 기본 그래프: 스텝-에너지, 스텝-힘. 문장으로 스텝-변위, 변위-힘, 변위-에너지, 주름 이면각(`angle`), 해 공간(`add_plot` `type: space3`, 주름 3개) 추가
- 자유도 `dofInfo`·기구 경로 `foldPath`·기구 모드 `nullModes`·해 공간 `solutionSpace` (solver.cpp, Python `analysis.py` 와 같은 방법). WASM `bh_dof`, `bh_space`. 모든 결과 요약에 자유도 표시
- 주름은 화면에서 1부터 "2-7 주름", 내부 키는 0부터 "1-6"
- 언어: `web/i18n.js` (`t(한국어 원문, {변수})`, 브라우저 언어가 ko 면 한국어, 아니면 영어, EN/KR 버튼, localStorage `bah-lang`), 영어 문구는 `web/i18n_en.js`. 새 화면·메시지 문구는 반드시 `t()` 로 감싸고 영어를 추가. 스펙에 저장하는 이름(구속 이름 등)은 한국어 원문으로 두고 표시할 때 번역
- 문장 규칙: 낱말은 `web/rules_vocab.js` (한국어 + 영어), 흐름은 `web/rules.js`. 새 표현은 사전에 추가
- 예제 영어: `make_examples.py` 의 `EN` (title_en, note_en, prompts_en)
- Theory 문서: `web/docs/overview.md` (원 논문·이론 정리) → `equations.md` → `verification.md`, 영어판 `*.en.md` 도 같이 갱신. README 는 영어 위주(외국인 사용자가 많음), 맨 위 원 논문 강조는 유지
- 논문·MATLAB 원본은 저장소에 올리지 않음 (사용자 맥 `FEM-LLM-web/bar-and-hinge_model/`)
