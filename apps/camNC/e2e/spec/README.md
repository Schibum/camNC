# Behaviour specs

These specs state how the tool should behave as data, so they survive a rewrite of
the code they test. A scenario only says what a person does and what must then be
true. Nothing in `scenarios/` names a React component, CSS class or internal ID.

```text
scenarios/<domain>/*.json   what a person does and what must be true
adapters/<domain>.mjs       the only app-specific code: drive input, read state
goldens/<domain>/*.svg      reviewed pictures of named moments, normalized
run.mjs                     runner, matchers and golden comparison
```

To rewrite the app, replace the adapter. To add behaviour, add a scenario.

## Run

This starts its own dev server, because the adapter reads the saved design from the
running app. CI runs the same command.

```sh
pnpm --filter @wbcnc/camNC spec:cad
```

Options: `--url <running dev server>`, `--only <id prefix>`, `--headed`, `--list`, `--update-goldens`.

Results are one of `PASS`, `FAIL`, `XFAIL` (a listed known gap still fails) and
`XPASS` (a known gap now passes, so remove its `known` field). The run fails on
`FAIL` and `XPASS`, so a fix can't go unrecorded and a known gap can't be forgotten.

## Scenario format

```json
{
  "id": "sketch/dimension/point-line-normal",
  "title": "A point and a diagonal line dimension as their perpendicular distance",
  "evidence": "reference-live 2026-11-06",
  "known": "optional: why this still fails, removed once it passes",
  "steps": ["line 20,10 120,70", "key d", { "expect": { "tool": "dimension" } }]
}
```

All coordinates are sketch millimetres with Y up, never pixels. `evidence` says why
this is the desired behaviour: `reference-live <date>`, `reference-report <name>`,
`reference-docs <page>`, `manu <date>` or `design <reason>`. A scenario with no real
reference should say `design`, so nobody later mistakes it for reference CAD behaviour.
The comparison reports themselves are kept outside this repository.

### Steps

| Step                                                                                     | Meaning                                                                 |
| ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `key <key>`                                                                              | Press a key or chord, such as `key Shift+a`                             |
| `type <text>`                                                                            | Type characters at the current focus                                    |
| `click x,y` / `dblclick x,y` / `shiftclick x,y` / `rclick x,y`                           | Pointer press and release with real movement                            |
| `hover x,y`                                                                              | Move there without pressing                                             |
| `down x,y` / `move x,y` / `up`                                                           | One gesture in parts, for checks made mid-gesture                       |
| `drag x,y x,y`                                                                           | Press, move in steps, release                                           |
| `wheel x,y <delta>`                                                                      | Scroll at a position                                                    |
| `tool <name>`                                                                            | Choose a tool that has no shortcut, by its visible name                 |
| `line x,y x,y` / `rect x,y x,y` / `circle x,y r` / `arc x,y x,y x,y`                     | Draw with the normal tool, then leave it                                |
| `field <label> <value>`                                                                  | Fill a labelled field and press Enter                                   |
| `finish` / `cancel` / `design` / `goto <stage>`                                          | Finish the sketch, cancel it, return to Design, or click a stage link   |
| `uncheck <label>` / `hold <key>` / `release <key>` / `selectdim` / `editdim` / `addpart` | Hold a modifier, select or edit the first dimension label, add a part   |
| `handle <start\|end> <point\|segment> [add]`                                             | Click a spline's own tangent handle, optionally adding to the selection |
| `frame <name>`                                                                           | Compare this moment with a reviewed golden, if one exists               |
| `{ "expect": { ... } }`                                                                  | Check the state at this moment                                          |

### Expectations

Geometry: `entities`, `entitiesInclude`, `entityCount`, `acceptedEntityCount`, `regions`.
Dimensions and relations: `dimensions`, `dimensionsInclude`, `constraintsAtLeast`,
`labelText`. Interface: `tool`, `status`, `readout`, `pageText`, `focus`, `canFinish`, `canUndo`,
`canRedo`, `stage`, `cursor`. Appearance: `previewCount`, `strokePx`, `colors`,
`annotation`. See `adapters/sketch.mjs` for exact meanings and default tolerances.

## Goldens

A golden is a normalized SVG of the canvas at a `frame`: screen pixels at a fixed
viewport, effective stroke widths and colours written out, no names or IDs. Constraint
glyphs are left out until their placement is deterministic between runs. Open one in
a browser to review it. Comparison allows 2 px of drift, so ordinary numeric noise
doesn't fail but a floating label or a thick preview does.

Goldens change only through `--update-goldens`, and that diff must be reviewed like
code. Prefer an `expect` where a fact can be stated; use a golden for what only a
picture can pin down. Don't capture a golden from behaviour known to be wrong.

## Adding domains

`domain` comes from the scenario ID, so `part/...` loads `adapters/part.mjs`. Features
such as extrude, pockets, mirrored parts, patterns and assemblies get their own folder
and adapter, reusing this runner, its step grammar and its result rules. A new domain
adds its own steps and canonical state (for example bodies, faces, mates) through its
adapter's `step` and `check` functions.
