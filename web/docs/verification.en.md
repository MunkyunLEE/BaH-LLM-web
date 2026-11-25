# Verification (against MERLIN2 v1.1 run in Octave 8.4)

Relative error = max |difference| / max |MERLIN2 value|. Bar connectivity is checked including order, and the number of increments must match MERLIN2. All cases are compared with `compat` (reproduce MERLIN2 quirks) on.

| Case | Description | Bar connectivity | Bar areas | Increments (C++ / MERLIN2) | Displacement | Load / reaction | Energy | Bar stress Sx |
|---|---|---|---|---|---|---|---|---|
| gmiura | MERLIN2 GMiura_pointload (generalized Miura, N5B8 auto, prescribed displacement 200) | identical | 4.7e-16 | 203 / 203 | 1.2e-08 | 1.5e-09 | 7.6e-10 | 1.1e-07 |
| polygon | MERLIN2 PolygonTest (hexagon, N5B8 polygon centre, MGDCM) | identical | 4.2e-16 | 29 / 29 | 2.0e-14 | 5.5e-15 | 3.9e-15 | 1.6e-11 |
| miura_force | Miura 3x3, N5B8 auto, MGDCM, SuperLinear bending | identical | 2.9e-16 | 60 / 60 | 2.3e-02 | 2.0e-02 | 4.9e-02 | 2.4e-02 |
| miura_force_el | same model, bending EnhancedLinear only | identical | 2.9e-16 | 60 / 60 | 7.5e-08 | 5.6e-08 | 1.1e-07 | 8.1e-08 |
| miura_n4b5 | Miura 3x3, N4B5 manual, prescribed displacement | identical | 0.0e+00 | 50 / 50 | 3.8e-08 | 1.5e-08 | 1.2e-08 | 2.3e-08 |
| eggbox | Eggbox 3x3, N4B5 manual (MERLIN 2016 constants), MGDCM | identical | 0.0e+00 | 40 / 40 | 8.1e-08 | 1.0e-08 | 1.8e-08 | 2.3e-07 |
| kresling | Single Kresling (triangle panels, Eq. 15), prescribed displacement | identical | 2.7e-16 | 60 / 60 | 1.6e-15 | 2.1e-12 | 4.1e-13 | 1.1e-13 |

- The 2% difference in miura_force is not an equation difference. The initial SuperLinearBend stiffness (0.001k at Δθ = 0) depends on 1e-8 round-off in MATLAB acos, a sensitivity of MERLIN2 itself. The same model with EnhancedLinear bending (miura_force_el) agrees to 1e-7.

## Self-checks of the added features

- Mirror symmetry: Miura 6x4 full model vs x-symmetric half model, displacement relative error 1.6e-15, total energy 74.4639 / half ×2 74.4639
- Geometric contact (`tests/feature/contact.py`): a 45° flap is folded onto a base plate by a force. Contact off → the flap passes through to z = -11.5 mm. Contact on (gap 0.2 mm) → it stops at a minimum distance of 0.356 mm and carries a load factor of 7.9. Pushing prescribed nodes into the plate stops at 0.2 mm with `contact_blocked`. Per-pair gradient and Hessian agree with finite differences to 1e-10 (including the edge-edge mollifier)
- Local pressure load stiffness, bar and hinge stiffness, elasto-plastic hinge tangent: 1e-11 against finite differences (`core/tools/fdcheck.cpp`)
