# @wbcnc/cam — built-in CAM MVP spikes

STEP → flat boards → 2.5D features → pocket/outline toolpaths → FluidNC G-code, in pure TypeScript (Node-tested,
no DOM, so it can move into a web worker as is).

Run: `pnpm --filter @wbcnc/cam test -- run`. The fixture tests skip when `/Users/manu/development/w69b/cnc/sample-data`
is missing (e.g. in CI); the synthetic toolpath tests always run.

Outputs (G-code, PNG top views, `summary.md`) go to `sample-data/poc-out/`.

## Pipeline / files

| file           | what                                                                                                 |
| -------------- | ---------------------------------------------------------------------------------------------------- |
| `import.ts`    | occt-import-js → meshes with B-rep face ranges; planar-face analysis; flat orientation; flip; dedupe |
| `features.ts`  | height levels, pocket regions, outlines, through holes, bottom-side faces, sloped area               |
| `toolpaths.ts` | offset pockets (ramped), outline roughing + final pass, tabs, tool choice, op order                  |
| `gcode.ts`     | FluidNC dialect, Fusion-style tool table, M0 pauses, greedy G2/G3 arc fitting                        |
| `analyze.ts`   | test-only: G-code reader, metrics, registration, depth-map sim, SVG render                           |
| `*.test.ts`    | one per spike; `compare.test.ts` is spike 5                                                          |

## Results

### 1. Import + flat detection

- occt-import-js 0.0.23 works in Node out of the box (wasm located next to the JS).
  **wasm 7.60 MB raw / 3.08 MB gzip / 2.32 MB brotli** (+ 97 KB JS). Init ~20 ms (after the file is cached).
- kinderregal (6 bodies) reads in **~1.1–1.2 s** at 0.01 mm deflection; besteckkasten (9 bodies) ~1.0 s;
  messerblock 35 ms. Flat detection for all 6 kinderregal bodies: ~30 ms.
- Flat detection = planar B-rep faces clustered by direction; thickness axis = largest-area direction that has faces
  on both sides; up side = the side with more floor area strictly between top and bottom; in-plane rotation from the
  largest wall cluster, long side → X; translate bbox min to 0 (Z0 = stock bottom).
- kinderregal: `560x140x8` ×2 (left/right), `400x140x8` ×2 (Part 1/3, deduped by size + triangle count),
  `400x136.5x8` (Part 2), `400x380x3` (back; brief said 380x400 — we put the long side on X). All exact.
- besteckkasten: `vert1` has floors on both sides (top 2345 mm², bottom 572 mm²) → reported as two-sided.
  `connector top` (36x19x29, 75% prismatic) is a real 3D part, correctly flagged by `prismaticRatio`.

### 2. Features

- Not slicing: for a 2.5D prism the union of up-facing horizontal triangles grouped by Z is the exact height map, so we
  project + union with Clipper2 (`clipper2-ts`, pure TS, 125 KB / 34 KB gz). Slicing would only help with undercuts.
- Pocket region at level L = footprint − material above L, extended 2 mm past the outline where it is open to the
  edge (rabbets), never into higher material. Deeper levels are nested in shallower ones, so each pocket starts at the
  previous floor.
- kinderregal sides: 9 mortises at z=3.8 + a rabbet at z=3.5 open to the edge; shelves: rabbet at 3.5 that stops 4.2 mm
  short of the ends; middle shelf and back: outline only. besteckkasten `vert1`: 3 through holes, pockets at 3.8,
  **bottom faces at 4.2 → "needs flipped setup" warning**; `flipPart()` + `cutThrough: false` makes that second setup.
- Time: 50–220 ms per board after one fix (see failures). 235 mm² of sloped faces on the sides (small chamfer/fillet
  bits) are ignored and reported.
- Arc fitting: done once on the final toolpaths in `gcode.ts` (covers tessellated circles and Clipper round joins), not
  on features. Cheap: <10 ms per file.

### 3+4. Toolpaths + G-code

- Pocket: contour-parallel offsets (stepover 0.4D), innermost ring first, rings within 1.5×stepover linked by a feed
  move, otherwise retract + ramp along the loop (3°, falls back to plunge on loops shorter than D). Stepdown from the
  material (oak 0.75D). Climb by default (Clipper orientation already gives material-on-the-right for pockets).
- Outline: roughing levels to +1 mm (≤4 mm steps, evenly split) leaving 0.1 mm, then one pass at −0.3 at half feed;
  climb = CW around the part, CCW inside holes. Start in the middle of the longest edge.
- Tabs (option): 2 mm high, 5 mm (+D) long, ≥3, ~every 250 mm, spread over the long straight runs; applied to every
  pass below tab height (roughing at +1 included). See `*.tabs.png`.
- Tool choice: each feature gets the largest tool that fits, smaller ones cut the narrow spots of a pocket it doesn't
  reach; ops sorted smallest tool first, then pockets (top-down) → holes → outline. messerblock: its 3.1 mm knife slots don't fit 3.175 → "no tool fits"; with a D=3 bit added it
  emits pocket with T3, then `M0 (MSG Spindle OFF. Change to T1 D=3.175, re-zero Z, spindle ON 15000RPM)`, outline T1.
- G-code: `G21 G90 G94 G17`, `( Tools Table:)` + `(  T1 D=3.175 CR=0 - ZMIN=-0.3 - flat end mill )` (camNC's
  `parseToolInfo` reads it back exactly), `M0 (MSG Turn ON spindle 15000RPM)`, safe Z = top+5, retract top+2, approach
  top+1, modal G/F, G2/G3 with I/J, ends with retract + `G0 X0 Y0`. camNC's `parseGCode` parses all outputs; bounds as
  expected; `hasProbeOrZeroCommand` = false.

### 5. Comparison with Fusion (kinderregal, `poc-out/summary.md`)

Our paths are registered on Fusion's setup frame (4 rotations, ICP on the final pass, overlap to break symmetry).

| setup            | final pass dev mean / p95 / max (mm) | pocket coverage / same depth / extra | time F / ours / ours Fusion-like (min) | size F / ours (KB) |
| ---------------- | ------------------------------------ | ------------------------------------ | -------------------------------------- | ------------------ |
| left             | 0.002 / 0.009 / 0.015                | 99.9% / 99.9% / 2 mm²                | 4.3 / 6.5 / 4.6                        | 64.1 / 14.5        |
| right            | 0.005 / 0.016 / 0.023                | 99.9% / 99.9% / 2 mm²                | 4.4 / 6.5 / 4.6                        | 62.6 / 14.5        |
| shelf top bottom | 0.001 / 0.002 / 0.012                | 99.9% / 99.9% / 0 mm²                | 2.8 / 3.5 / 2.4                        | 11.0 / 5.7         |
| shelf middle     | 0.001 / 0.002 / 0.012                | –                                    | 2.0 / 2.6 / 1.9                        | 8.9 / 5.0          |
| back             | 0.001 / 0.002 / 0.003                | –                                    | 1.8 / 2.7 / 1.8                        | 3.6 / 0.6          |
| besteck vert1    | 0.000 / 0.001 / 0.013                | 99.5% / 98.8% / 12 mm²               | 9.5\* / 5.7 / 3.8                      | 54.8 / 12.1        |
| vert1 flipped    | – (pockets only)                     | 100% / 100% / 1 mm²                  | 0.7 / 0.8 / 0.6                        | 26.0 / 13.6        |

Coverage = share of Fusion's pocket cells (0.25 mm depth-map sim of both files) that we also cut; same depth = within
0.05 mm. Times: cuts at programmed feed, rapids 9000 XY / 1800 Z. "Fusion-like" = same paths with full-depth pockets
and a full-feed final pass, which is what Fusion did: our paths are as efficient; the default gap is our 0.75D pocket
stepdown and half-feed final pass. \*Fusion's b1 setup also cuts other boards nested on the same sheet.

PNGs (Fusion left, ours right; colour = depth, dashed = rapids): `poc-out/left.png`, `right.png`,
`shelf top bottom.png`, `shelf middle.png`, `back.png`, `besteck vert1.png`, `besteck vert1 flipped.png`,
`messerblock.png`; tab variants `*.tabs.png`.

## Failures / surprises

- **Fusion's "left" setup is the STEP body named "right"** (and vice versa). By name they only match mirrored; swapped
  they match by a pure rotation including mortise/rabbet positions. Worth a look in the Fusion file — or naming
  convention (viewed from inside vs. outside).
- Bug found by the PNGs: the final outline pass started at the nearest _vertex_ of the loop instead of the nearest point
  on it → a 210 mm diagonal feed move at −0.3 across the part. Fixed (nearest point on edge), plus a safety net in the
  emitter: any "direct" link longer than D becomes retract/rapid/plunge.
- Region clean-up with round joins put an arc on every tessellation vertex (9.3k-vertex pocket regions, 0.8 s per
  offset, 3 s per part). Miter joins + simplify: 2.3k vertices, ~0.3 s per part.
- Registering on the outline alone is ambiguous for symmetric boards (shelf rabbet ended up on the wrong side → 0%
  coverage). Overlap of all cuts picks the right rotation.
- messerblock.gcode in the Fusion folder is from an older design (180x353 vs STEP 357x210x27): not compared.
- `noUncheckedIndexedAccess` is off in this package (dense typed-array index math); revisit before productizing.

## Open issues

- **Arc fitting**: greedy, vertex tol 0.01 mm, sagitta ≤ 0.05 mm, ≥4 points, ≤45°/segment. Works for tessellated
  circles and round joins; no helical (G2 with Z) ramps yet; a closing chord of a full circle stays G1. Splines (the
  curved side profiles) come out as many short arcs with slightly varying radii — fine for FluidNC, but not minimal.
- **Small features**: "left in corners" is reported (area not reachable by the bit) but not acted on; no rest
  machining with a smaller bit, no dogbones/T-bones for joinery corners (Fusion leaves them rounded too).
- **Flip detection** works as a heuristic (floor area per side) and the flipped setup cuts the right pockets, but there
  is no registration story between setups (pins/edge stops) and the flipped Y origin is the mirrored corner.
- Bit swap via M0 assumes the user can re-zero Z during the pause; with FluidNC that probably means a manual flow or
  splitting the job into one file per tool (what Fusion users do).
- Pocket strategy is offset-only: narrow 0.1 mm-wide rings for 3.1 mm slots with a 3 mm bit degenerate into lines
  (works, but a slot/trace strategy would be cleaner). No adaptive/trochoidal clearing, no finishing pass on pocket walls.
- Ramps use the loop itself; for very small loops we plunge (logged nowhere yet).
- Tabs: only on outlines (not holes), rectangular (no triangular/ramped tabs), placement ignores curved edges.
- Sloped/3D faces are ignored (reported).
- Nesting multiple boards on one sheet (what Fusion's b1 setup does) is out of scope.

## Recommended next steps

1. Move `loadStep` → worker (comlink, like the existing workers); locate wasm via Vite `?url`. Load wasm lazily: it's
   2.3 MB brotli.
2. UI: part list with dims/qty/warnings (two-sided, sloped, no tool fits), per-part settings, preview with camNC's
   existing toolpath + stock-sim views (our G-code already parses there).
3. Defaults: decide on pocket stepdown (Fusion cut 4.2–4.5 mm deep pockets in one pass with 3.175 in oak) and final-pass
   feed; expose a "fast" preset.
4. Second setup: emit both files (top + flipped) and a registration aid (e.g. outline cut in the first setup, flip
   about X with a fence).
5. Multiple tools: per-tool files instead of M0 swaps, plus rest machining with the smaller bit.
6. Keep `compare.test.ts` as a regression harness (it already caught a dangerous move).

## Planned work (queued, in this order)

1. **Cutting data per bit × material.** An app-wide table keyed by (tool id, material): feed, plunge feed, stepdown,
   stepover, rpm, final-pass feed factor. Seeded from the Fusion library where it has values, else from the material
   defaults (hardwood with bits ≤ 4 mm: stepdown 0.5×D). Lookup order: job override → saved bit × material → library →
   default, and the Plan table shows where each value comes from. Inline edit on Plan asks "save for this bit +
   material" (default) or "only this job". An editor on the tools/settings page. The per-job max stepdown is the first
   job-override field.
2. **Global nesting per thickness.** Use all stock sheets of a thickness (sizes, quantities, offcuts), search over
   orderings and sheet choices (greedy with lookahead, a smallest-sheet-that-fits pass for the rest, a few seeded random
   restarts), and minimize total sheet area, then board count, then prefer one big offcut. Parts pinned by hand keep
   their board and position. Auto-fill gets undo. Tests on the fixtures and random cases: never worse than today's
   greedy fill.
3. **3D Plan view (concept A + B).** The material-removal simulation with a timeline (one band per op, neutral
   playhead across the bands, no violet in the op palette) by default, and a Result / Toolpath toggle to B's per-op
   layers at real Z (eye per op, isolate and frame, rapids hideable). One shared op list with identical ops grouped,
   the same colour per op in both modes. A See-through toggle (semi-transparent stock with the finished-part ghost).
   Top uses an orthographic camera by default, with a Perspective / Orthographic toggle that keeps the framing. View
   toggles are remembered. Zoom-to-op keeps small features readable. It replaces the 2D preview; `/cam/poc-3d` goes.
4. **Flip setups** for parts with features on both faces. Per board, choose how side B is registered:
   - **Camera re-align** (default): flip the board, drag the outline onto it in the camera view, as for side A.
   - **Dowel pins**: side A drills two pin holes through the board into the spoilboard. Side B is placed on the pins,
     mirrored about the pin axis.
   - **Fence / corner**: the board is pushed against a fixed fence and stop, and mirrored about the fence line.
     Side B gets its own program from the bottom-face features (`flipPart`, `cutThrough: false`), mirrored to match the
     chosen registration. It becomes a guided step in the machine queue ("flip board A, align, zero Z").

### Holding parts: built

A tab holds only if the stock beyond it is solid to the board's edge (the hold check, `hold.ts`): with the old default
spacing (gap 8, margin 5.2 with 1/8") the strip left between two cuts is ~1.7 mm and holds nothing.

- **Spacing for tabs.** Tab boards default to gap 2 x bit + 3.5 (10 mm with 1/8") and margin bit + 3.5 (6.7 mm), so a
  strip that holds is left everywhere. Boards whose spacing is tighter (set by hand, or frozen at another bit) say so and
  offer "Widen for tabs". Regal board A: 1537 x 1551 -> 1542 x 1564.
- **Placement** (`tabPlan.ts`). Only on straight runs of the part's outer edges (its convex hull: not in notches, slots
  or the inside of an L), 10 mm or more from corners, facing stock that holds. Two opposite sides, the long ones if both
  can hold, else the ends: one tab per side, two on sides of 400 mm or more, at least Min # (3) in all, spread along the
  side. Held on one side only (it would pivot) counts as not held.
  - Regal before: 2 to 12 tabs per part, all on the side facing the board's big free area (top: 11 of 12 on one 350 mm
    end; the sockel strips: 8 tabs at their tips), board B all skin. After: 4 per part, two on each long side, all hold.
- **Parts tabs can't hold** get their fallback: a bottom skin (default, 1 mm), tabs anyway, or "I hold it down", for the
  job or per part. A part with neither tabs that hold nor a fallback blocks the Plan step.
- **Bottom skin + guided freeing** is a hold-down of its own (per board, "Use for all boards" for the job): every outline
  stops a skin above the bottom, no tabs; at the machine "Free parts" cuts them free one at a time and pauses for each.
- Not yet: frame and webs, triangular/ramped tabs, tabs on holes, moving tabs by hand, widening a single gap in the nest.

### Flip setups: built (fc17894), known limits

- The board always turns top to bottom (board y -> H - y). Turning left to right (x -> W - x) isn't offered yet; it would
  need the parts flipped about the other axis and the dowel mirrors at (W - x, y).
- Side B's camera alignment uses the same board outline as side A; there's no separate side B outline (e.g. to align on
  the cut part edges instead of the board edge).
- Dowel pins need room clear of the parts (and of their mirrors): fitted boards often have none; the Plan step says so.
- Fence / corner relies on the board's entered height being exact; nothing measures it.
- Not yet tried on the machine.

## First real cut: checklist

Before trusting camNC's programs with good wood. Use the machine queue ("Take the job to the machine") throughout.

The flow up to the machine can be tried first on the branch preview, https://feat-cam-mvp-camnc-preview.plainoss.workers.dev.

**1. Air cut** (kinderregal board A, nothing on the bed):

- [ ] Zero Z 10 mm above the spoilboard (Z0 raised), so every pass runs in the air.
- [ ] Alignment: the dashed board outline lands where the board would be; turning it 0.5° turns the program.
- [ ] The confirm pause before the spindle starts, M3 at the cutting data's rpm, the dwell; M5 and M30 at the end.
- [ ] Moves look sane: rapids only above the stock top, ramps (no plunges) into pockets, outlines last.
- [ ] Bit swap between programs (with a second bit): the queue stops, swap, zero Z again, next program; XY untouched.
- [ ] Resume from a pass: stop mid-program, resume from a later pass in the Resume card: spindle on, plunge where
      the pass starts, continues the same path.

**2. One kinderregal shelf on scrap** (oak or similar, 8 mm, alone on a board):

- [ ] Z0 on the spoilboard (the bottom of the board); stock thickness measured and entered on the Boards step.
- [ ] Pocket and rabbet depths and widths against the model (calipers): 4.2 / 4.5 deep, walls where they should be.
- [ ] Tab hold: tabs only where the stock beyond holds; the part stays put through the final pass; tabs break off or
      cut cleanly (guided tab removal if chosen).
- [ ] Freeing skin parts (a part with "skin", e.g. a board with a small margin): "Free parts" cuts one part at a time,
      bit up and spindle off at each pause, M3 + dwell before the next; nothing moves while paused.
- [ ] Flip with camera re-align (a part with features underneath, e.g. besteckkasten vert1): turn top to bottom,
      drag the outline onto it again, side B pockets land on the underside where the model has them.
- [ ] Edge quality: no tear-out at the rabbet and outline edges; inside corners rounded to the bit radius as shown.

Note anything off with the board, program name and line (the machine view shows the current line).
