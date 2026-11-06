# Analytic machining cases

This corpus retains small, reproducible machining inputs and the exact programs generated from them. Provenance is analytic polygons/circles plus explicit synthetic cutting settings. The small-case circle inputs state their tessellation count and reserve 0.002 mm of source uncertainty for that approximation; polygon coordinates are the exact supplied source. Every case fixes a 0.05 mm total geometry budget. The larger default-policy cases below separately state their feature-scoped polygon inputs. Coordinates use millimeters, XY0 at the stock's lower-left corner, and Z0 at the stock bottom.

| Case                         | Behavior under test                                                                                        |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `pocket-island`              | Island protection, pocket entries, and corner feeds                                                        |
| `concave-pocket`             | Concave cavity geometry and material-side corner scheduling                                                |
| `tool-width-threshold`       | Slots below, equal to, and slightly above the cutter diameter                                              |
| `profile-tab-shoulders`      | Bounded-depth profiling, repeated contour-ramp laps, and holding-tab shoulders                             |
| `tangent-fallback`           | Explicit fallback when tangent leads cannot fit a narrow hole                                              |
| `split-physical-tools`       | Separate programs for equal-diameter cutters with distinct identities/speeds                               |
| `controlled-pocket-island`   | Curvature-controlled offset roughing, explicit cleanup, and residual-stock diagnostics                     |
| `polished-profiles`          | Optional vertical entry/inside-hole exit blends, spring passes, and inner-circle finishing feed correction |
| `board-neighbor-open-pocket` | Board composition keeps an edge-open pocket out of a second retained part across a 2 mm gap                |

Each `.input.json` specifies stock, geometry, tools/settings, and independently checked expectations. `build.ts` converts these primitives into the planner's explicit feature contract, merging equal-height cavities and including deeper regions in each higher clearing level. Board-mode inputs additionally state each part's local geometry, placement, rotation and hold-down policy, and run the public `camBoard` composition path. The builder splits programs by mounted tool/spindle speed and posts `.nc` files. `manifest.json` records input/program SHA-256 values, byte lengths, operation/pass counts, observed diagnostics, and the setup summary returned for each posted program. Its fingerprint must match the program header. Multiple tool programs have numbered filename suffixes.

The neighboring-part case has a 100×70×12 mm main part at board (20,30), with a local pocket (15,0)–(85,12) down to Z6. A second 110×18×12 mm part at (15,10) reaches Y28, leaving only a 2 mm gap below the main part. A D6 tool clears only the pocket on a 140×120 mm board. The test checks every posted feed chord below the stock surface against the neighbor's exact rectangle, requires the retained 2 mm cutter clearance within the 0.05 mm budget, and verifies nine floor-coverage points so suppressing the operation cannot pass. The historical `.before.json` pins source commit `d506ca0067a5b8fc8f44be47bf878e7f63c88498`, the exact new fixture input and original program hash: the old output intruded 2.01 mm into the neighbor. That unsafe program is excluded from the accepted NC snapshots.

Neighbor protection deliberately treats neighboring outer outlines as retained material; a future through hole is not assumed already cleared. Interdependent frame-hole nesting without a supported stock/holding sequence can fail closed with a planning error. This corpus case uses two disjoint outer silhouettes.

The expected programs characterize the implementation. They are reviewed alongside geometric invariants: protected-island clearance, safe/depth-limited output, retained tab material after a swept-tool simulation, semantic feed alignment, unsupported slot outcomes, and physical tool separation. The exact-width slot currently has no positive-area cutter-center region; this case records that limitation rather than treating it as supported centerline slotting. The independent assertions must continue to hold when a deliberate algorithm improvement changes program bytes.

Nine larger [default-policy cases](./performance/README.md) cover panel/outline output, closed and open-edge cavities, and circular pockets with four source tessellations. They independently cap executable blocks, tiny feed lines, retracts, and modeled automatic time. Every case retains its generated programs, hashes and metrics. Together the small and default-policy sets contain 17 cases and 18 `.nc` files. Their tests check cutter envelopes and final-wall/floor coverage, so omitting machining cannot satisfy the cost limits. The same command below regenerates both sets. Historical pre-change measurements remain separate from the current manifest and are not rewritten by regeneration.

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

The checker verifies the loopback URL and simulated board configuration before submitting programs. It enables check mode or reuses check mode left by an interrupted run. Parser errors and transport disconnects fail at the affected file and line; it never reconnects or skips blocks. Check-mode exit resets the simulator, so cleanup waits for its disable message rather than an acknowledgement that reset may discard. This validates command acceptance independently of the geometry assertions. The ordinary test suite requires no simulator or network connection.
