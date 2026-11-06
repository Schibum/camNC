# Default machining output cost

These analytic cases keep ordinary default settings under review at practical dimensions. They are deliberately specified here rather than assuming the geometry or settings of an unspecified external report. `cases.json` is the complete input; the manifest expands the defaults that applied when generating the retained `.nc` programs.

| Case                               | Exact geometry                                                          | Stock         | Tool     |
| ---------------------------------- | ----------------------------------------------------------------------- | ------------- | -------- |
| `default-panel-600x400x18-d6`      | Outside rectangular profile, XY (15,15)–(615,415), top Z18, final Z−0.3 | 630×430×18 mm | 6 mm     |
| `default-outline-120x80x12-d3.175` | Outside rectangular profile, XY (10,10)–(130,90), top Z12, final Z−0.3  | 140×100×12 mm | 3.175 mm |
| `default-pocket-150x120x6-d3.175`  | Rectangular cavity, XY (10,10)–(160,130), top Z12, floor Z6             | 170×140×12 mm | 3.175 mm |

All use `DEFAULT_SETTINGS`. The panel overrides only the tool diameter/name; the pocket overrides only `cutThrough: false` to isolate clearing from its outside outline. The other profile uses the default tool unchanged. Relevant defaults are oak stepdown factor 0.5D (3 mm or 1.5875 mm), 1800 mm/min cutting feed, 480 mm/min plunge/ramp feed, 900 mm/min profile finish feed, 40% stepover, 3° contour ramps, 0.1 mm radial profile allowance, 1 mm roughing floor, 5 mm safe height, 2 mm retract height, 0.05 mm geometry tolerance, and no tabs. `profileFinishStepdown` and `cornerFeed` are deliberately omitted to exercise their default policies. The manifest records `DEFAULT_SETTINGS` merged with each case's overrides; the retained programs also record the actual resulting feeds. This is synthetic cutting data, not a qualified material recipe.

`baseline-before.json` records the same inputs run against an isolated archive of source commit `f5c76b20287b84f736d3e5bb19e01029281796d5`. The input SHA-256, expanded settings, generated-program SHA-256 and measurements are retained. Baseline source was isolated before edits to the motion planner. The ordinary regeneration command never overwrites this historical record.

For these defined fixtures, the before/after measurements are:

| Case                          | Executable blocks | Tiny G1 lines <0.1 mm | Retract/clearance commands | Modeled automatic seconds |
| ----------------------------- | ----------------: | --------------------: | -------------------------: | ------------------------: |
| Panel 600×400×18, D6          |          205 → 90 |                 0 → 0 |                     14 → 3 |        1473.588 → 594.026 |
| Outline 120×80×12, D3.175     |         235 → 100 |                 0 → 0 |                     16 → 3 |         408.926 → 161.597 |
| Pocket 150×120×6 deep, D3.175 |      12910 → 3483 |              9024 → 0 |                    185 → 9 |       2209.624 → 2059.818 |

`limits.json` supplies independent ceilings with headroom above the improved output. All three pre-change cases exceed their block, retract and modeled-time ceilings; the pocket also exceeds its tiny-line ceiling. Updating the generated files cannot bypass these limits. Tests also require final-depth machining at all four profile-wall midpoints, cutter clearance from the retained rectangle, cutter containment in the pocket, and floor coverage at 25 points spanning the cavity.

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
