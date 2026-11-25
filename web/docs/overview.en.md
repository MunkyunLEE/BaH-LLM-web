# BaH-LLM-web: theory overview

## 0. Original papers and authors

All theory, equations and algorithms in this simulator belong to the authors of the papers below. This web tool is only an implementation of their work in C++/WebAssembly. If you use its results, please cite the original papers.

| Tag | Paper | Used here for |
|---|---|---|
| [F17] | E. T. Filipov, K. Liu, T. Tachi, M. Schenk, G. H. Paulino (2017) Bar and hinge models for scalable analysis of origami. IJSS 124, 26–45. doi:10.1016/j.ijsolstr.2017.05.028 | N5B8 model, panel bending and fold stiffness, bar areas, eigenvalue analysis of the stiffness matrix |
| [LP16] | K. Liu, G. H. Paulino (2016) MERLIN: A MATLAB implementation to capture highly nonlinear behavior of non-rigid origami. IASS 2016 | N4B5 model, dihedral angle and derivatives, Ogden bars, EnhancedLinear hinges, MGDCM |
| [LP18] | K. Liu, G. H. Paulino (2018) Highly efficient nonlinear structural analysis of origami assemblages using the MERLIN2 software. Origami⁷ | Polygon panel centre, triangle bar areas, displacement loading, MERLIN2 v1.1 code (the reference) |
| [T26] | Y. Tang, Y. Chu, Y. Mei, Y. Zhu, K. Liu (2026) Bar-and-hinge model for elasto-plastic origami analysis. Proc. R. Soc. A 482: 20251119. doi:10.1098/rspa.2025.1119 | Bar and hinge return mapping, incremental algorithm |
| [WF20] | S. R. Woodruff, E. T. Filipov (2020) A bar and hinge model formulation for structural analysis of curved-crease origami. IJSS 204–205, 114–127. doi:10.1016/j.ijsolstr.2020.08.010 | Triangle mesh bar stiffness, bend edge stiffness |
| [K26] | R. P. Khawale, E. Mehdizadeh, J. Brigham, E. T. Filipov (2026) Rapid kirigami simulation using the bar & hinge approach. IJMS 329, 112107. doi:10.1016/j.ijmecsci.2026.112107 | Kirigami bar and bending stiffness, cuts, initial imperfection |

Other methods used: MGDCM constraint parameters (Leon, Lages, de Araújo, Paulino 2014, Mech. Res. Commun. 56), geometric contact (Li et al. 2020, Incremental Potential Contact, ACM TOG 39(4); details follow ipctk), DOF count and self-stress (Pellegrino & Calladine 1986, IJSS 22; Schenk & Guest 2011, Origami⁵), rigid folding paths (Tachi 2009, Origami⁴).

## 1. The bar-and-hinge model in short

- Panels are split into triangles and every edge becomes an axial bar. Bars carry in-plane stretching and shear [F17].
- A rotational spring (hinge) sits on every edge shared by two triangles. Hinges on the original creases are **fold** hinges; hinges on the diagonals added inside panels are **panel bending** hinges [F17, LP16].
- The hinge angle is the dihedral angle θ ∈ [0, 2π), π when flat. Hinge energy is a function of θ, bar energy a function of the Green-Lagrange strain [LP16].
- The stationarity of Π = Σ_bars A L W(E) + Σ_hinges ∫M dθ − Fᵀu is solved with Newton-type methods.
- Discretization: N5B8 (centre node in each quad + 4 diagonals) [F17], N4B5 (one short diagonal) [LP16], polygons with the centre point X* [LP18].

## 2. Analysis types

### 2.1 Static (prescribed displacement)
Exactly the MERLIN2 Displacement scheme. Each increment predicts U ← U + step·ΔŪ, then solves K ΔU = R on the free DOFs with damped Newton iterations. Failed increments are retried with a smaller step [LP18, T26 Algorithm 1].

### 2.2 Arc-length (MGDCM)
The load factor λ and displacements are solved together. The first iteration uses Δλ = ±Δl √(GSP), later iterations are constrained by Δλ = −(Δû_i1·Δū_r)/(Δû_i1·Δû) [LP16, Leon 2014]. The summary load is λ·|ΣF|; reactions are the internal forces at prescribed and loaded DOFs.

### 2.3 Modal (stiffness based)
- **Stiffness matrix only (no mass):** K_ff φ = λ φ. Near-zero eigenvalues are rigid-body and mechanism modes; the modes with the smallest eigenvalues are the softest deformation modes [same as the eigenvalue analysis in F17].
- **With mass:** K_ff φ = ω² M φ with a lumped mass (panel mass split equally to its vertices and centre node). Solved as the symmetric problem M^(−1/2) K M^(−1/2); f = ω / 2π is shown.
- Solved on the initial geometry. With symmetry planes only symmetric modes appear.

### 2.4 Degrees of freedom (mechanisms and self-stress)
Panels are treated as rigid: bar lengths and panel bending hinge angles become constraints g(x) = 0.
- Constraint Jacobian J: bar rows ∂L/∂x = (−n, +n), panel bending hinge rows ∂θ/∂x (MERLIN2 dihedral derivatives)
- r = rank J_f (columns of unsupported DOFs, SVD, tolerance 1e-7 σ_max)
- Mechanisms m = n_f − r − (6 rigid-body motions if unsupported), self-stress states s = n_c − r
- The extended Maxwell rule n_f − n_c = m − s (+6) holds [Pellegrino & Calladine 1986, Schenk & Guest 2011].
- Shown in every result summary. A DOF-only analysis displays the null-space vectors of J_f (mechanism modes) as deformed shapes.

### 2.5 Kinematics (rigid folding path)
The target dihedral θ_d* of the driver creases d is reached in n equal steps [as in Tachi 2009].
- Predictor: minimum-norm solution of [J_f; A_d] v = [0; θ_d,goal − θ_d] (complete orthogonal decomposition)
- Corrector: [J_f; A_d] Δx = −[g; θ_d − θ_d,goal], up to 30 iterations, residual < 1e-10 L̄
- A_d = ∂θ_d/∂x. Without supports the first panel's 6 DOFs are fixed to remove rigid-body motion.
- If the path cannot be followed (residual > 1e-6), it stops before that step and reports it.

### 2.6 Solution space (dihedral space of three creases)
This method is not from the papers; it is ported from the earlier Python implementation of this project.
- On the initial shape, the null space N of J_f (dimension k = number of mechanisms) and the fold rates R = A_F N are computed.
- Directions d: ±1 for k = 1; 24 random unit vectors (seed 0) for k > 1.
- Drivers: for k = 1 the crease with the largest |d·R|; for k > 1 creases in order of total rate until the selected columns of R reach rank k.
- Each direction is followed with the 2.5 algorithm for 60 steps to θ₀ + 0.9π (d·R)/max|d·R| (clipped to 0.001 … 2π−0.001), and the dihedral angles of the three chosen creases are drawn as 3D curves.
- The yellow curve is the current analysis path (the kinematic path, or the per-step dihedral angles of a static/arc-length analysis). It shows how far the elastic path departs from the rigid folding bundle in grey.

## 3. Results and plots

- After every analysis the **step-energy** plot (total, bar US, fold UF, bend UB, plus plastic and contact when present) and the **step-force** plot appear. Modal analyses show eigenvalues or frequencies, kinematic analyses the driver dihedral angles.
- Plots added by sentences: step-displacement of a node, displacement-force, displacement-energy, energy components, load factor, crease dihedral (`crease 2-7 angle plot`), solution space (`solution space of creases 2-7, 7-12, 6-7`).
- The default contours follow the original MERLIN2 code (`GMiura_pointload.m`, `VisualFold.m`).
- **Sum of bar forces (MERLIN2 Vertex, default):** at each node the sum of |Sx·A| of the connected bars (N), scaled to the maximum over all steps
- **Bar stress Sx (MERLIN2 Edge):** each bar coloured by its second Piola-Kirchhoff stress Sx, panels in grey, range ±max |Sx| over all steps
- Extra contours not in MERLIN2: stored energy density, fold / bend / bar energy densities, displacement magnitude and components. The energy density is defined in 3.1.
- Extra contours when plasticity is on (accumulated like Abaqus PEEQ, they never decrease):
- **Bar equivalent plastic strain PEEQ:** for each bar the accumulated plastic log strain α_bar = Σ|Δε_p| of the Tang 2026 return mapping. The surface shows the maximum over the bars at each node
- **Fold crease accumulated plastic rotation (deg):** α_hinge = Σ|Δθ_p| of each fold hinge, drawn on the hinge axis
- **Bend hinge accumulated plastic rotation (deg):** α_hinge of panel bending hinges and bend edges; other hinges in grey
- The range is 0 to the maximum over all steps, so stepping through the frames shows plasticity building up. Each frame stores bar stress Sx, α_bar and α_hinge
- "Result mesh lines" toggles all model bars (including the N5B8 diagonals).

### 3.1 Energy density contour (added in this implementation)
The energy density of node i is e_i = E_i / A_i (N·mm/mm²).

**Numerator E_i (nodal energy, C++ `record`)**
- The energy A_e L_e W_e of bar e is split ½ to each end node.
- The energy U_h of hinge h (fold and panel bending) is split ½ to each of the two nodes on the hinge axis. The two wing nodes that define the dihedral receive nothing.
- The stored energy density is bar + fold + bend; fold, bend and bar densities are also shown separately.
- With this split Σ_i E_i = US + UF + UB exactly.

**Denominator A_i (nodal tributary area, `backend.js` `nodeAreas`)**
- For every triangle of the analysis model (with N5B8 a quad panel is 4 triangles around its centre node), one third of its initial area goes to each vertex: A_i = Σ_{triangles t ∋ i} S_t / 3.
- The initial area is used, so the denominator does not change during deformation.

**Colour range**: 0 to the maximum over all steps, so a colour means the same value at every step.

**Reading notes**
- Fold energy is concentrated at the two end nodes of each crease; colours along the crease are interpolated between them.
- The N5B8 centre node receives ½ of the panel bending hinge energy (corner–centre diagonals), so strongly bent panels look darker in the middle.
- Boundary and corner nodes have small tributary areas, so the same energy can look larger there.

## 4. Example sentences

- Supports and loads: `fix the bottom`, `fix node 8`, `move node 59 by -30 mm in y`, `pressure 0.001 MPa downward on top`, `gravity`, `symmetry x = 0`
- Analysis: `arc-length`, `stiffness modes 6`, `6 modes` (with mass), `dof analysis`, `drive crease 2-7 to 120 deg`, `run`
- Results: `node 59 force-displacement plot`, `fold energy plot`, `crease 2-7 angle plot`, `solution space of selected creases`, `how many dof?`, `max reaction?`
- Korean sentences work in either language mode.
