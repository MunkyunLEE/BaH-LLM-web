# Equation ledger (paper equation ↔ MERLIN2 code ↔ C++ ↔ test)

The reference is the MERLIN2 v1.1 MATLAB code. Where paper and code differ, the code is followed and the difference is listed in section 8.
C++ locations are relative to `core/src/`. Tests are `tests/merlin/cases.py` (comparison with MERLIN2 run in Octave) and `core/tools/fdcheck.cpp` (finite differences).

## 1. Discretization (MERLIN2 `PrepareData`)

| Item | Source | MERLIN2 | C++ | Test |
|---|---|---|---|---|
| N5B8 centre node: intersection of the diagonals, on the short diagonal if non-planar | Filipov 2017 Fig. 3 · MERLIN2 §3.2 | `findbend` (N5B8) | `model.cpp` `findbend` | gmiura, miura_force node coordinates 1e-14 |
| Polygon centre X* = argmin Σ h_ij/d_ij | Liu & Paulino 2018 Eq. (13), (14) | `FindOptCenter` (fminunc, two starts) | `model.cpp` `optCenter` (BFGS, two starts) | polygon 1e-14 |
| N4B5 short-diagonal split, polygons split repeatedly by the shortest diagonal | Liu & Paulino 2018 §3.1 | `findbend` (N4B5), `DividePolygon` | `findbend`, `dividePolygon` | miura_n4b5, eggbox |
| Triangle list, fold and boundary detection | Liu & Paulino 2016 Eq. (8), (9) | `findfdbd` | `findfdbd` (same ordering) | identical bar connectivity in all cases |
| Bar order = [bend axes; fold axes; boundary] | MERLIN2 | `Bars = [Bend(:,1:2);Fold(:,1:2);Bdry]` | `build` | identical |

## 2. Automatic material (MERLIN2 `GetMaterial`, auto mode)

| Item | Source | C++ |
|---|---|---|
| k = E t³ / 12(1-ν²) | Filipov 2017 | `model.cpp` `G` |
| Quad bars: A_X = t(H²-νW²)/2H(1-ν²), A_Y = t(W²-νH²)/2W(1-ν²), A_D = tν(H²+W²)^1.5/2HW(1-ν²) (MERLIN2 takes absolute values) | Filipov 2017 Eq. (5) | `build` quad branch |
| Triangle and polygon bars: A = 2St / ((1-ν) ΣL) | Liu & Paulino 2018 Eq. (15) | `build` (`triBars = merlin2`) |
| Panel bending: k (D/t)^(1/3) / D per diagonal, times the length L0 for each half hinge | Filipov 2017 Eq. (8) (factor 1.0) | `kpb` |
| Fold: K_ℓ = L_F k / L*, K_m = 0.55 k (L_F/t)^(1/3), K_F = 1/(1/K_ℓ + 1/K_m), per length K_F / L_F | Filipov 2017 Eq. (9)–(11) | `kpf` |
| L* = (L*/L_F ratio) × L_F, ratio 3 by default | Liu & Paulino 2018 LScaleFactor | `Lratio` (absolute `Lstar` also possible) |

## 3. Elements (MERLIN2 `GlobalK_fast_ver`)

| Item | Source | C++ | Test |
|---|---|---|---|
| Green-Lagrange strain E = B·u/L + ½|Δu|²/L² | Filipov 2017 Eq. (17) | `elem.cpp` `internal` | all cases |
| Bar force T = A L S ∂E/∂u, stiffness K = A L C (∂E/∂u)⊗(∂E/∂u) + (A S/L) G | Liu & Paulino 2018 Eq. (8), Filipov 2017 Eq. (19)–(24) | `internal` | fdcheck 1e-11 |
| Ogden bar: S = C0/(α1-α2) (λ^(α1-2) - λ^(α2-2)), λ = √(2E+1), α = (5, 1) | Liu & Paulino 2016 §3.3 | `barLaw` | all cases |
| Dihedral θ ∈ [0, 2π), flat = π, sign from n·r_ij | Liu & Paulino 2018 §2.2 | `geom.cpp` `dihedral` (atan2 form, same value) | |
| First derivatives of the dihedral (di, dj, dk, dl) | MERLIN2 code | `dihedralGrad` | fdcheck |
| Second derivatives of the dihedral (dii … dlk, 12×12) | MERLIN2 code | `dihedralHess` (MERLIN2 expressions as is) | fdcheck 1e-11 |
| Hinge T = M ∂θ/∂u, K = k ∂θ⊗∂θ + M ∂²θ | Liu & Paulino 2018 Eq. (12) | `internal` | |
| EnhancedLinear (tan stiffening outside θ1, θ2) | Liu & Paulino 2016 §3.3 | `hingeLaw` | |
| SuperLinearBend M = k L sign(Δ)|Δ|^(4/3), tangent max(4/3 |Δ|^(1/3), 0.001) k L | Filipov 2017 Eq. (8) | `hingeLaw` | |
| Diagonal regularisation K + 1e-8 I | MERLIN2 code | `internal(regularize)` | |

## 4. Solvers (MERLIN2 `PathAnalysis`)

| Item | Source | C++ | Test |
|---|---|---|---|
| MGDCM load factor increment (first iteration, GSP of the next increment, constraint during iterations) | Liu & Paulino 2016 §3.4, Leon 2014 | `solver.cpp` `stepForce` | polygon 1e-14, miura_force_el 1e-7, eggbox 1e-8 |
| Radius control: halve and restart if iterations > 15, ×1.5 if < 3 | MERLIN2 code | `stepForce` | |
| Prescribed displacement: predictor U += step·ΔU, damped Newton, failure if iter ≥ ((step>1)+1)·50/(damping+1), up to 10 retries with half step, then step ×1.5 and damping ×0.75 | Liu & Paulino 2018 §4.2, Tang 2026 Algorithm 1 | `stepDisp` | gmiura 1.2e-8, kresling 1e-15 |
| Convergence ‖ΔU_free‖ < 1e-6, max 50 iterations | MERLIN2 code | `Settings` | |
| Reaction = internal force at prescribed DOFs | sign opposite to MERLIN2 `Fhis = -IF(ImpDofs)` | `record` | gmiura 1.5e-9 |
| Energies US = Σ A L W, UF, UB | MERLIN2 `PostProcess` | `record` | 7e-10 |
| Bar stress Sx per frame | MERLIN2 `PostProcess` `STAT.bar.Sx` | `record`, frame layout | max 2.3e-7 (miura_force 2.4%, see section 8) |

## 5. Elasto-plasticity (Tang 2026, MERLIN-PLAS)

| Item | Equation | C++ |
|---|---|---|
| Bar: λ = λe λp, ε = ln λ, τ = E εe, f = |τ| - (Y + H α) | (2.1)–(2.10), (2.18)–(2.26) | `internal` `LOGPLAS` |
| Bar stress and tangent: S = τ/λ², C = (C_b - 2τ)/λ⁴, C_b = E H/(E+H) | list on pp. 8–9, (2.39), (2.44) | `internal` |
| Hinge: M^tr = L k0 (θ - θp), f = |M| - (Y + H α), C_h = (Lk0) H/(Lk0+H) | (2.27)–(2.30), list on p. 9, (2.52) | `internal` `PLASTIC` |
| State updated only on converged increments, restored on failure | Algorithm 1 | `commitState`, `stepDisp` |
| Yield and hardening are per-length values × hinge length (UI "plastic hinge" = σy t²/4) | | `coreInput` |

## 6. Alternative stiffness formulas

| Item | Source | C++ (`options`) |
|---|---|---|
| Triangle bars k = E A_T t / L², longest edge × (α²/2 + 5/4) | Woodruff & Filipov 2020 Eq. (3), (4) | `triBars = woodruff` |
| Bend edge k_b = E t³ L² / 6 (A1 + A2) (with ν: 2 k L²/(A1+A2)) | Woodruff & Filipov 2020 Eq. (11) | `edgeBend = woodruff` (default) |
| Kirigami bars k_s = F_s E A_T t / L, F_s = 0.85 | Khawale 2026 Eq. (5) | `triBars = khawale` |
| Kirigami bending k_B = F_B E L² t³ / 48(A1+A2), F_B = 0.125 | Khawale 2026 Eq. (11) | `edgeBend = khawale` |
| Initial imperfection: random along face normals | Khawale 2026 §4.1 | `imperfection` |

## 7. Additions not in MERLIN2

| Item | Implementation | Check |
|---|---|---|
| Mirror symmetry: zero normal displacement at both ends of boundary bars on the plane, half hinges on those bars (fourth node = mirror image of the third, stiffness ½) | `build` symmetry branch, `internal` ghost | full vs half model displacement 1.6e-15, energy ×2 identical (`tests/feature/symmetry.py`) |
| Pressure Global: p A0/3 in a fixed direction (initial area) | `pressureForce` | |
| Pressure Local: f = p/6 (b-a)×(c-a) at each vertex, load stiffness ∂f/∂u (LU when non-symmetric) | `pressureForce`, `solveFree` | finite differences 5e-11 |
| Geometric contact: point-triangle and edge-edge barrier κ b(d - d_min), b(s) = -(s-d̂)² ln(s/d̂), hinge angle barrier, continuous collision detection (conservative advancement, same as ipctk AdditiveCCD used in the Python reference), symmetry wall | `contact.cpp` | per-pair gradient and Hessian vs finite differences 1e-10 |
| Edge-edge mollifier (IPC, same as ipctk): x = ‖(b-a)×(d-c)‖², ε = 1e-3 ‖e_a⁰‖² ‖e_b⁰‖², multiply by m = (2 - x/ε) x/ε when x < ε. Removes the Newton oscillation caused by the non-smooth distance of parallel edges | `eeMollifier` | folded plate contact test: oscillation → convergence |
| Contact step limit in MGDCM iterations: if the collision-free fraction α < 1, ΔU and Δλ are scaled by 0.8α (as in the Python reference) | `stepForce` | |
| If prescribed nodes are blocked by another face (predictor collisions more than 40 times without a large increment) the run stops with `contact_blocked` | `stepDisp` | |
| Modal: stiffness only K_ff φ = λ φ, or K_ff φ = ω² M φ (lumped mass: panel mass split equally to vertices and centre node, Filipov 2017 1/5), symmetric eigenproblem M^(−1/2) K M^(−1/2) | `modal` | free-free Miura 4x4: 6 zero eigenvalues |
| DOF: rigid-panel constraint Jacobian J (bars ±n, panel bending hinges ∂θ/∂x), r = rank J_f (SVD, 1e-7 σ_max), mechanisms m = n_f − r − 6 (if unsupported), self-stress s = n_c − r | `dofInfo` (same as Python `dof_analysis`) | Miura 4x4: constraints 168, free 123, rank 116, mechanisms 1, self-stress 52 |
| Kinematic path: predictor = minimum-norm solution of [J_f; A_d] v = [0; Δθ_d], up to 30 corrector iterations (residual < 1e-10 L̄, with stagnation check), first panel's 6 DOFs fixed if unsupported | `foldPath` (same as Python `rigid_fold_path`) | Miura 4x4 driver 60° → 120° in 60 steps |
| Mechanism modes: null space of J_f (shown as shapes when there are no drivers) | `nullModes` | |
| Solution space: null-space fold rates R = A_F N, directions ±1 (k=1) or 24 random (k>1), driver selection, target θ₀ + 0.9π d·R/max, 60 steps, kept up to the step before residual > 1e-6 | `solutionSpace` (same as Python `solution_space`, only the random generator differs) | |

## 8. Differences between MERLIN2 and the papers (findings)

1. `GetMaterial` quads: when all four panel edges are folds, A_X and A_Y are attached to the sorted fold order, so X/Y areas can be swapped per edge (differs from paper Eq. (5)). The C++ default follows the paper; `compat` reproduces MERLIN2.
2. `GetMaterial` quad bending stiffness kb has the same ordering issue (diagonals swap when vertex numbers are not ascending). Handled as in 1.
3. The prescribed displacement loop condition `dspmvd <= 1` goes one increment beyond the target (e.g. -30.11 mm for a -30 mm target). The C++ default stops exactly at the target; `compat` reproduces MERLIN2.
4. The default `LScaleFactor` in the code is 2 × mean L_F (a length), unlike the description (a ratio, default 3). C++ uses ratio 3 by default.
5. GSP denominator in the first iteration of the next MGDCM increment: the paper has Δû^(i-1)·Δû^i, the code Δû^i·Δû^i. C++ follows the code.
6. SuperLinearBend drops to a tangent of 0.001 k at Δθ = 0, so a 1e-8 round-off in MATLAB acos alone changes the initial stiffness. Arc-length paths of flat, soft sheets are therefore round-off sensitive even between MATLAB runs (the cause of the 2% difference in miura_force; with EnhancedLinear bending it agrees to 1e-7).
7. `findfdbd` sorts the triangle vertex indices (`sort(trigl,2)`), so orientation is lost and half of the four N5B8 triangles of a quad panel get a flipped normal (input triangles too). Stiffness and internal forces do not depend on orientation and are unchanged; only the triangles used for shading, pressure and contact are flipped to match the original panel vertex order (Newell normal). Miura 3x3: flipped triangles 72/144 → 0, MERLIN2 comparison unchanged.
