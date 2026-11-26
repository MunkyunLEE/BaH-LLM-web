# 수식 대장 (논문 식 ↔ MERLIN2 코드 ↔ C++ 구현 ↔ 시험)

정답 기준은 MERLIN2 v1.1 MATLAB 코드입니다. 논문과 코드가 다르면 코드를 따르고, 차이는 아래 "MERLIN2 와 논문의 차이" 에 적었습니다.
C++ 위치는 `core/src/` 기준입니다. 시험은 `tests/merlin/cases.py` (Octave 로 돌린 MERLIN2 결과와 대조) 와 `core/tools/fdcheck.cpp` (수치 미분) 입니다.

## 1. 이산화 (MERLIN2 `PrepareData`)

| 내용 | 출처 | MERLIN2 | C++ | 시험 |
|---|---|---|---|---|
| N5B8 중심 절점: 사각형 대각선 교점, 비평면이면 짧은 대각선 위 | Filipov 2017 그림 3 · MERLIN2 3.2 절 | `findbend` (N5B8) | `model.cpp` `findbend` | gmiura, miura_force 절점 좌표 1e-14 |
| 다각형 중심점 X* = argmin Σ h_ij/d_ij | Liu & Paulino 2018 식 (13), (14) | `FindOptCenter` (fminunc 두 번 시작) | `model.cpp` `optCenter` (BFGS 두 번 시작) | polygon 1e-14 |
| N4B5 짧은 대각선 분할, 다각형은 최단 대각선 분할 반복 | Liu & Paulino 2018 3.1 절 | `findbend` (N4B5), `DividePolygon` | `findbend`, `dividePolygon` | miura_n4b5, eggbox |
| 삼각형 목록, 접힘·경계 찾기 | Liu & Paulino 2016 식 (8), (9) | `findfdbd` | `findfdbd` (같은 정렬 순서) | 모든 예제 바 연결 순서 일치 |
| 바 순서 = [휨축; 접힘축; 경계] | MERLIN2 | `Bars = [Bend(:,1:2);Fold(:,1:2);Bdry]` | `build` | 일치 |

## 2. 재료 자동 산정 (MERLIN2 `GetMaterial`, auto 모드)

| 내용 | 출처 | C++ |
|---|---|---|
| k = E t³ / 12(1-ν²) | Filipov 2017 | `model.cpp` `G` |
| 사각형 바: A_X = t(H²-νW²)/2H(1-ν²), A_Y = t(W²-νH²)/2W(1-ν²), A_D = tν(H²+W²)^1.5/2HW(1-ν²) (MERLIN2 는 절댓값) | Filipov 2017 식 (5) | `build` 사각형 분기 |
| 삼각형·다각형 바: A = 2St / ((1-ν) ΣL) | Liu & Paulino 2018 식 (15) | `build` (`triBars = merlin2`) |
| 패널 휨: 대각선마다 k (D/t)^(1/3) / D, 반쪽 힌지마다 길이 L0 를 곱함 | Filipov 2017 식 (8) (계수 1.0) | `kpb` |
| 접힘: K_ℓ = L_F k / L*, K_m = 0.55 k (L_F/t)^(1/3), K_F = 1/(1/K_ℓ + 1/K_m), 길이당 K_F / L_F | Filipov 2017 식 (9)~(11) | `kpf` |
| L* = (L*/L_F 비) × L_F, 비 기본 3 | Liu & Paulino 2018 LScaleFactor | `Lratio` (절대값 `Lstar` 도 가능) |

## 3. 요소 (MERLIN2 `GlobalK_fast_ver`)

| 내용 | 출처 | C++ | 시험 |
|---|---|---|---|
| Green-Lagrange 변형률 E = B·u/L + ½|Δu|²/L² | Filipov 2017 식 (17) | `elem.cpp` `internal` | 전 예제 |
| 바 내력 T = A L S ∂E/∂u, 강성 K = A L C (∂E/∂u)⊗(∂E/∂u) + (A S/L) G | Liu & Paulino 2018 식 (8), Filipov 2017 식 (19)~(24) | `internal` | fdcheck 1e-11 |
| Ogden 바: S = C0/(α1-α2) (λ^(α1-2) - λ^(α2-2)), λ = √(2E+1), α = (5, 1) | Liu & Paulino 2016 3.3 절 | `barLaw` | 전 예제 |
| 이면각 θ ∈ [0, 2π), 평면 = π, 부호는 n·r_ij | Liu & Paulino 2018 2.2 절 | `geom.cpp` `dihedral` (atan2 형태, 값은 같음) | |
| 이면각 1차 미분 (di, dj, dk, dl) | MERLIN2 코드 | `dihedralGrad` | fdcheck |
| 이면각 2차 미분 (dii … dlk 12×12) | MERLIN2 코드 | `dihedralHess` (MERLIN2 식을 그대로 옮김) | fdcheck 1e-11 |
| 힌지 T = M ∂θ/∂u, K = k ∂θ⊗∂θ + M ∂²θ | Liu & Paulino 2018 식 (12) | `internal` | |
| EnhancedLinear (θ1, θ2 밖에서 tan 강화) | Liu & Paulino 2016 3.3 절 | `hingeLaw` | |
| SuperLinearBend M = k L sign(Δ)|Δ|^(4/3), 접선 max(4/3 |Δ|^(1/3), 0.001) k L | Filipov 2017 식 (8) | `hingeLaw` | |
| 대각 보정 K + 1e-8 I | MERLIN2 코드 | `internal(regularize)` | |

## 4. 풀이 (MERLIN2 `PathAnalysis`)

| 내용 | 출처 | C++ | 시험 |
|---|---|---|---|
| MGDCM 하중 계수 증분 (첫 반복, 다음 증분 GSP, 반복 중 제약) | Liu & Paulino 2016 3.4 절, Leon 2014 | `solver.cpp` `stepForce` | polygon 1e-14, miura_force_el 1e-7, eggbox 1e-8 |
| 반경 조절: 반복 > 15 이면 반으로 줄이고 되돌림, < 3 이면 1.5 배 | MERLIN2 코드 | `stepForce` | |
| 강제 변위: 예측 U += 보폭·ΔU, 감쇠 뉴턴, 실패 판정 iter ≥ ((보폭>1)+1)·50/(감쇠+1), 재시도 10회까지 보폭 ½, 이후 보폭 1.5 배·감쇠 0.75 | Liu & Paulino 2018 4.2 절, Tang 2026 알고리즘 1 | `stepDisp` | gmiura 1.2e-8, kresling 1e-15 |
| 수렴 ‖ΔU_free‖ < 1e-6, 최대 반복 50 | MERLIN2 코드 | `Settings` | |
| 반력 = 강제 변위 자유도의 내력 | MERLIN2 `Fhis = -IF(ImpDofs)` 의 부호 반대 | `record` | gmiura 1.5e-9 |
| 에너지 US = Σ A L W, UF, UB | MERLIN2 `PostProcess` | `record` | 7e-10 |

## 5. 탄소성 (Tang 2026, MERLIN-PLAS)

| 내용 | 식 | C++ |
|---|---|---|
| 바: λ = λe λp, ε = ln λ, τ = E εe, f = |τ| - (Y + H α) | (2.1)~(2.10), (2.18)~(2.26) | `internal` `LOGPLAS` |
| 바 응력·접선: S = τ/λ², C = (C_b - 2τ)/λ⁴, C_b = E H/(E+H) | 8~9 쪽 목록, (2.39), (2.44) | `internal` |
| 힌지: M^tr = L k0 (θ - θp), f = |M| - (Y + H α), C_h = (Lk0) H/(Lk0+H) | (2.27)~(2.30), 9 쪽 목록, (2.52) | `internal` `PLASTIC` |
| 상태는 수렴한 증분에서만 갱신, 실패하면 이전 상태로 | 알고리즘 1 | `commitState`, `stepDisp` |
| 항복·경화는 길이당 값 × 힌지 길이 (화면 "소성 힌지" = σy t²/4) | | `coreInput` |

## 6. 강성 대안 식

| 내용 | 출처 | C++ (`options`) |
|---|---|---|
| 삼각형 바 k = E A_T t / L², 가장 긴 변 × (α²/2 + 5/4) | Woodruff & Filipov 2020 식 (3), (4) | `triBars = woodruff` |
| 휨 엣지 k_b = E t³ L² / 6 (A1 + A2) (ν 포함하면 2 k L²/(A1+A2)) | Woodruff & Filipov 2020 식 (11) | `edgeBend = woodruff` (기본) |
| 키리가미 바 k_s = F_s E A_T t / L, F_s = 0.85 | Khawale 2026 식 (5) | `triBars = khawale` |
| 키리가미 휨 k_B = F_B E L² t³ / 48(A1+A2), F_B = 0.125 | Khawale 2026 식 (11) | `edgeBend = khawale` |
| 초기 결함: 면 법선 방향 무작위 | Khawale 2026 4.1 절 | `imperfection` |

## 7. MERLIN2 에 없고 새로 넣은 것

| 내용 | 구현 | 확인 |
|---|---|---|
| 미러 대칭: 평면 위 테두리 바의 두 끝 법선 변위 0, 그 바에 반쪽 힌지 (네 번째 절점 = 세 번째 절점의 거울상, 강성 ½) | `build` 대칭 분기, `internal` ghost | 전체 모델과 반 모델 변위 1.6e-15, 에너지 ×2 일치 (`tests/feature/symmetry.py`) |
| 압력 Global: p A0/3 고정 방향 (처음 면적) | `pressureForce` | |
| 압력 Local: f = p/6 (b-a)×(c-a) 각 꼭짓점, 하중 강성 ∂f/∂u (비대칭이면 LU) | `pressureForce`, `solveFree` | 수치 미분 5e-11 |
| 기하 접촉: 점-삼각형·선-선 거리 장벽 κ b(d - d_min), b(s) = -(s-d̂)² ln(s/d̂), d_min = 접촉 간격 (비우면 패널 두께 t), d̂ = d_min, 힌지각 장벽, 연속 충돌 검사 (보수적 전진, 파이썬 참조의 ipctk AdditiveCCD 와 같은 방식), 대칭면 벽 | `contact.cpp` | 쌍별 경사·헤시안 수치 미분 1e-10 |
| 선-선 장벽의 평행 보정 (IPC mollifier, ipctk 와 같음): x = ‖(b-a)×(d-c)‖², ε = 1e-3 ‖e_a⁰‖² ‖e_b⁰‖², x < ε 이면 m = (2 - x/ε) x/ε 를 장벽에 곱함. 평행한 두 선에서 거리 함수가 매끄럽지 않아 뉴턴이 진동하던 문제를 없앰 | `eeMollifier` | 접힌 판 접촉 시험에서 진동 → 수렴 |
| 호장법(MGDCM) 반복에 접촉 이동량 제한: 충돌 없이 갈 수 있는 비율 α < 1 이면 ΔU·Δλ 를 0.8α 배 (파이썬 참조와 같음) | `stepForce` | |
| 강제 변위 절점이 다른 면에 막히면 (예측 단계 충돌이 큰 증분 없이 40 번 넘게 반복) `contact_blocked` 로 멈춤 | `stepDisp` | |
| 모달: 강성만 K_ff φ = λ φ, 또는 K_ff φ = ω² M φ (집중 질량: 패널 질량을 꼭짓점과 중심점에 균등 분배, Filipov 2017 1/5), 대칭 고유값 문제 M^(−1/2) K M^(−1/2) | `modal` | 미우라 4x4 자유-자유: 강체 모드 6 개 0 고유값 |
| 자유도: 강체 패널 구속 야코비안 J (바 ±n, 패널 휨 힌지 ∂θ/∂x), r = rank J_f (SVD, 1e-7 σ_max), 기구 m = n_f − r − 6(지지 없음), 자기 응력 s = n_c − r | `dofInfo` (Python `dof_analysis` 와 같음) | 미우라 4x4: 구속 168, 자유 123, 계수 116, 기구 1, 자기 응력 52 |
| 기구 경로: 예측 [J_f; A_d] v = [0; Δθ_d] 최소 노름 해, 보정 30회 (잔차 < 1e-10 L̄, 수렴 정체 판정 포함), 지지가 없으면 첫 패널 6 자유도 고정 | `foldPath` (Python `rigid_fold_path` 와 같음) | 미우라 4x4 구동 60° → 120° 60 스텝 |
| 기구 모드: J_f 영공간 (구동 주름이 없을 때 변형 모양으로 표시) | `nullModes` | |
| 해 공간: 영공간 각속도 R = A_F N, 방향 ±1 (k=1) 또는 무작위 24개 (k>1), 구동 주름 선택, 목표 θ₀ + 0.9π d·R/max, 60 스텝, 잔차 1e-6 넘는 스텝 앞까지 | `solutionSpace` (Python `solution_space` 와 같음, 난수 생성기만 다름) | |

## 8. MERLIN2 와 논문의 차이 (발견 사항)

1. `GetMaterial` 사각형: 패널 네 변이 모두 접힘이면 A_X·A_Y 를 정렬된 접힘 순서에 붙여, 변마다 X/Y 면적이 뒤바뀔 수 있음 (논문 식 (5) 와 다름). C++ 기본은 논문 식대로, `compat` 를 켜면 MERLIN2 와 같게.
2. `GetMaterial` 사각형 휨 강성 kb 도 같은 정렬 문제 (꼭짓점 번호가 오름차순이 아니면 대각선이 뒤바뀜). 처리 방식은 1 과 같음.
3. 강제 변위 반복 조건 `dspmvd <= 1` 때문에 목표보다 한 증분 더 감 (예: -30 mm 목표에서 -30.11 mm). C++ 기본은 목표에서 정확히 멈춤, `compat` 에서 MERLIN2 와 같게.
4. `LScaleFactor` 기본값이 코드에서는 2×평균 L_F (길이 단위) 로 들어가 설명 (비율, 기본 3) 과 다름. C++ 은 비율 3 을 기본으로.
5. MGDCM 다음 증분 첫 반복의 GSP 분모: 논문은 Δû^(i-1)·Δû^i, 코드는 Δû^i·Δû^i. C++ 은 코드를 따름.
6. SuperLinearBend 는 Δθ = 0 에서 접선 강성이 0.001 k 로 떨어져, MATLAB acos 의 1e-8 반올림 오차만으로도 처음 강성이 달라짐. 평평하고 부드러운 판의 호장법 경로는 이 때문에 MATLAB 끼리도 반올림에 민감함 (miura_force 예제 2% 차이의 원인, 휨을 EnhancedLinear 로 바꾸면 1e-7 일치).
7. `findfdbd` 가 삼각형 꼭짓점 번호를 정렬해(`sort(trigl,2)`) 방향이 사라지므로, 사각형 패널을 N5B8 로 나눈 삼각형 4개 중 절반의 법선이 뒤집힘 (입력 삼각형도 같음). 강성·내력은 방향과 무관해 그대로이고, 화면 음영·압력·접촉용 삼각형만 원래 패널 꼭짓점 순서(뉴웰 법선)에 맞춰 뒤집음. 미우라 3x3 에서 뒤집힌 삼각형 72/144 → 0, MERLIN2 대조 결과 변화 없음.
8. (접촉 확장, MERLIN2 에 없음) 접촉을 켠 강제 변위 해석은 증분 시작 예측값에 장벽 강성을 넣은 선형 탄성 예측 K_ff Δu_f = −K_fp Δu_p 를 쓰고, 뉴턴이 수렴하지 않은 증분은 총 퍼텐셜(바·힌지 에너지 + 장벽 − 외력 일)을 감쇠 뉴턴 (K + μI) + 에너지 선 탐색 + 연속 충돌 보폭 제한으로 최소화해 넘김 (누름판에서 떨어져 스냅하는 경우). 처음 가까운 접촉쌍 제외는 같은 연결 부품 안에서만. 모서리 절점이 모두 같은 구속·강제 변위인 패널의 N5B8 가운데 절점에도 같은 조건을 줌 (사각형 하나짜리 누름판). 접촉을 끄면 MERLIN2 와 같음.
