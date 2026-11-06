# Analytic machining cases

This corpus retains small, reproducible machining inputs and the exact programs generated from them. Provenance is analytic polygons/circles plus explicit synthetic cutting settings. Circle inputs state their tessellation count and reserve 0.002 mm of source uncertainty for that approximation; polygon coordinates are the exact supplied source. Every case fixes a 0.05 mm total geometry budget. Coordinates use millimeters, XY0 at the stock's lower-left corner, and Z0 at the stock bottom.

| Case                       | Behavior under test                                                                                        |
| -------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `pocket-island`            | Island protection, pocket entries, and corner feeds                                                        |
| `concave-pocket`           | Concave cavity geometry and material-side corner scheduling                                                |
| `tool-width-threshold`     | Slots below, equal to, and slightly above the cutter diameter                                              |
| `profile-tab-shoulders`    | Bounded-depth profiling, repeated contour-ramp laps, and holding-tab shoulders                             |
| `tangent-fallback`         | Explicit fallback when tangent leads cannot fit a narrow hole                                              |
| `split-physical-tools`     | Separate programs for equal-diameter cutters with distinct identities/speeds                               |
| `controlled-pocket-island` | Curvature-controlled offset roughing, explicit cleanup, and residual-stock diagnostics                     |
| `polished-profiles`        | Optional vertical entry/inside-hole exit blends, spring passes, and inner-circle finishing feed correction |

Each `.input.json` specifies stock, geometry, tools/settings, and independently checked expectations. `build.ts` converts these primitives into the planner's explicit feature contract, merging equal-height cavities and including deeper regions in each higher clearing level. It runs the normal planner, splits programs by mounted tool/spindle speed, and posts `.nc` files. `manifest.json` records input/program SHA-256 values, byte lengths, operation/pass counts, observed diagnostics, and the setup summary returned for each posted program. Its fingerprint must match the program header. Multiple tool programs have numbered filename suffixes.

The expected programs characterize the implementation. They are reviewed alongside geometric invariants: protected-island clearance, safe/depth-limited output, retained tab material after a swept-tool simulation, semantic feed alignment, unsupported slot outcomes, and physical tool separation. The exact-width slot currently has no positive-area cutter-center region; this case records that limitation rather than treating it as supported centerline slotting. The independent assertions must continue to hold when a deliberate algorithm improvement changes program bytes.

Run from the repository root:

```sh
pnpm --filter @wbcnc/cam exec vitest run src/machiningCases.test.ts
```

To regenerate after reviewing a planner/post change:

```sh
UPDATE_MACHINING_CASES=1 pnpm --filter @wbcnc/cam exec vitest run src/machiningCases.test.ts
```

Review the resulting `.nc` and manifest diffs and run the same test again without the update variable. Baseline updates still execute all invariants; changing snapshots cannot bypass a geometry or holding failure. The synthetic settings are regression inputs, with no claim of qualified material feeds or measured machining time.

Set `DEBUG_MACHINING_CASES=1` to print generation time per case. The optional parser check requires Node 22 and the repository's loopback simulator already running:

```sh
node packages/cam/test/machining-cases/check-fluidnc.mjs
```

The checker verifies the simulator identity and enables check mode before submitting programs. This validates command acceptance independently of the geometry assertions. The ordinary test suite requires no simulator or network connection.
