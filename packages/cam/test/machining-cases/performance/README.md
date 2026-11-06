# Default machining output cost

These analytic cases keep ordinary default settings under review at practical dimensions. They are deliberately specified here rather than assuming the geometry or settings of an unspecified external report. `cases.json` is the complete input; the manifest expands the defaults that applied when generating the retained `.nc` programs.

| Case                                 | Exact geometry                                                                 | Stock         | Tool     |
| ------------------------------------ | ------------------------------------------------------------------------------ | ------------- | -------- |
| `default-panel-600x400x18-d6`        | Outside rectangular profile, XY (15,15)–(615,415), top Z18, final Z−0.3        | 630×430×18 mm | 6 mm     |
| `default-outline-120x80x12-d3.175`   | Outside rectangular profile, XY (10,10)–(130,90), top Z12, final Z−0.3         | 140×100×12 mm | 3.175 mm |
| `default-pocket-150x120x6-d3.175`    | Rectangular cavity, XY (10,10)–(160,130), top Z12, floor Z6                    | 170×140×12 mm | 3.175 mm |
| `default-open-pocket-400x12x9-d6`    | Open cavity, XY (50,0)–(450,12), top Z18, floor Z9                             | 500×100×18 mm | 6 mm     |
| `default-open-pocket-400x40x3-d6`    | Open cavity, XY (50,0)–(450,40), top Z18, floor Z15                            | 500×100×18 mm | 6 mm     |
| `default-round-pocket-d60x6-d6-n64`  | Regular 64-sided polygon inscribed in R30 circle at (40,40), top Z12, floor Z6 | 80×80×12 mm   | 6 mm     |
| `default-round-pocket-d60x6-d6-n128` | Same circular primitive with 128 source segments                               | 80×80×12 mm   | 6 mm     |
| `default-round-pocket-d60x6-d6-n256` | Same circular primitive with 256 source segments                               | 80×80×12 mm   | 6 mm     |
| `default-round-pocket-d60x6-d6-n512` | Same circular primitive with 512 source segments                               | 80×80×12 mm   | 6 mm     |

All use `DEFAULT_SETTINGS`. The panel overrides only the tool diameter/name; pockets set `cutThrough: false` to isolate clearing from the outside outline, and the open/round cases select the 6 mm tool. The other profile uses the default tool unchanged. Relevant defaults are oak stepdown factor 0.5D (3 mm or 1.5875 mm), 1800 mm/min cutting feed, 480 mm/min plunge/ramp feed, 900 mm/min profile finish feed, 40% stepover, 3° contour ramps, 0.1 mm radial profile allowance, 1 mm roughing floor, 5 mm safe height, 2 mm retract height, 0.05 mm geometry tolerance, and no tabs. `profileFinishStepdown`, `openWallAllowance`, and `cornerFeed` are deliberately omitted to exercise their default policies. The manifest records `DEFAULT_SETTINGS` merged with each case's overrides; the retained programs also record the actual resulting feeds. This is synthetic cutting data, not a qualified material recipe.

`round-open.cases.json` holds the six additional inputs. Their circle primitives explicitly produce regular source polygons: the accuracy scope starts at those supplied polygon features, with no declared uncertainty for an original CAD circle. Containment assertions use every polygon half-plane. They do not silently grant an ideal circle's larger interior to a coarse polygon. All four tessellations and both open-pocket cases retain their generated `.nc` files, hashes, metrics and geometry/cost checks. The nine default-policy cases have nine programs; the combined corpus has 17 inputs and 18 programs.

The retained programs total 148,779 bytes across the combined corpus, including 117,936 bytes for the nine default-policy programs. All six new programs together occupy 23,782 bytes. Individual byte counts and SHA-256 values are recorded in the manifests; historical dense programs remain outside the retained set.

`baseline-before.json` records the original three inputs run against an isolated archive of source commit `f5c76b20287b84f736d3e5bb19e01029281796d5`. The input SHA-256, expanded settings, generated-program SHA-256 and measurements are retained. Baseline source was isolated before edits to the motion planner. The ordinary regeneration command never overwrites this historical record.

`baseline-round-open-before.json` independently captures the added six inputs on source commit `850731a3706d0cd1bda6f8bfa74db87433025196`, isolated before their follow-on fixes. Both historical records retain their own exact input SHA-256 and expanded settings. Regeneration never rewrites either record. The open cases historically posted 19 retract/clearance commands each; the 64/128/256 round sources posted 1,090/1,462/786 G1 blocks, while the 512-segment control already posted 28. Cost ceilings must prevent the earlier fragmented output without relaxing the total geometry tolerance.

For these defined fixtures, the before/after measurements are:

| Case                          | Executable blocks | Tiny G1 lines <0.1 mm | Retract/clearance commands | Modeled automatic seconds |
| ----------------------------- | ----------------: | --------------------: | -------------------------: | ------------------------: |
| Panel 600×400×18, D6          |          205 → 90 |                 0 → 0 |                     14 → 3 |        1473.588 → 594.026 |
| Outline 120×80×12, D3.175     |         235 → 100 |                 0 → 0 |                     16 → 3 |         408.926 → 161.597 |
| Pocket 150×120×6 deep, D3.175 |      12910 → 3555 |              9024 → 0 |                    185 → 9 |       2209.624 → 2104.250 |

For the added fixtures, the earlier source is the separately captured `850731a` baseline:

| Case                                  | Executable blocks | G1 blocks | Retract/clearance commands | Modeled automatic seconds |
| ------------------------------------- | ----------------: | --------: | -------------------------: | ------------------------: |
| Open 400×12×9 deep, D6                |         196 → 148 |  108 → 72 |                     19 → 7 |         324.015 → 305.947 |
| Open 400×40×3 deep, D6                |         185 → 127 |   99 → 70 |                     19 → 4 |         284.900 → 269.474 |
| Round D60×6 deep, 64 source segments  |        1146 → 138 | 1090 → 38 |                      3 → 3 |          99.433 → 100.060 |
| Round D60×6 deep, 128 source segments |        1541 → 119 | 1462 → 32 |                      6 → 5 |         103.259 → 102.472 |
| Round D60×6 deep, 256 source segments |         874 → 111 |  786 → 27 |                      6 → 5 |         103.974 → 103.014 |
| Round D60×6 deep, 512 source segments |         116 → 112 |   28 → 28 |                      5 → 5 |         102.404 → 103.072 |

The round-case improvement concerns arc recovery and program size; modeled time is broadly unchanged. All new cases keep the same 0.05 mm total budget and feature scope. The current manifest and six-case historical record retain the configured stage allocations, including the separately reserved output/controller precision. Open cases retain step-limited cutting transitions and conservative fallbacks rather than requiring every hop to stay down.

`limits.json` supplies independent ceilings with headroom above the improved output. All three original pre-change cases exceed their block, retract and modeled-time ceilings; the rectangular pocket also exceeds its tiny-line ceiling. Round cases additionally cap G1 blocks and require circular blocks. Updating the generated files cannot bypass these limits. Tests also require final-depth profile-wall midpoints, clearance from retained rectangles beside open edges, source-polygon containment for circular pockets, wall coverage, and floor coverage spanning every cavity.

Metrics have deliberately narrow meanings:

- Executable blocks exclude comments and blank lines. Arcs count once, rather than once per visualization chord.
- Tiny feed lines are positive-length G1 blocks shorter than 0.1 mm, including feed approaches; this is not an arc-chord or force measurement.
- Retract/clearance commands count the initial clearance G0 and subsequent positive-Z work-coordinate G0 moves. Unknown machine-coordinate parking is excluded. The count describes programmed commands, rather than observed physical axis movement.
- Automatic seconds use `LOWRIDER_V4_REFERENCE_PROFILE` with the program's explicit dwell. The model excludes operator pauses and unresolved initial/park positioning. The manifest reports the skipped-move count and uncertainty; these values are neither measured cycle times nor machine qualification.

Regenerate and verify from the repository root:

```sh
UPDATE_MACHINING_CASES=1 pnpm --filter @wbcnc/cam exec vitest run src/machiningCases.test.ts
pnpm --filter @wbcnc/cam exec vitest run src/machiningCases.test.ts
```

Review the NC, settings, metric and geometry-invariant changes together before accepting an update. Host execution speed is not used as a ceiling.
