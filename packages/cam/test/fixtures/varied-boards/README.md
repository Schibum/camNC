# Varied boards

40 STEP files for end-to-end testing: curved parts, rings, gears, sign letters, stair stringers, finger joints, jigsaw
nests, trays of up to 60 parts. Each file is one board's worth of flat parts, all the same thickness, in millimetres.

**This is AI-generated test geometry, not real projects.** Nobody has cut these parts or checked them for use.

**These are polygon extrusions.** Every curve is a run of short planar facets, so they don't exercise the true circles
and splines of real CAD exports, whose walls import as curved faces. A circle here is a many-sided polygon, which can
behave differently: tabs need straight runs, for example, and a coarse polygon has them where a real circle wouldn't. Use
the CAD exports in the folder above for that. They also have no pockets or undersides to flip for: outlines and through
holes only.

- `boards.json`: the source. Each board has an `id`, `title`, `family`, `thickness`, the `w`/`h` of the sheet it was laid
  out on, and `parts` with `outer` and `holes` polygons in board coordinates (y up).
- `<id>.step`: one per board. Each part is its own product and solid, at its spot on that sheet.
- `generate.mjs`: writes the STEP files from `boards.json`, byte for byte the same on every run. `node generate.mjs`
  rewrites them; `--check` fails if they differ, and `src/variedBoards.test.ts` runs that check.

Importing nests the parts again from their bounding boxes, so the layouts in these files aren't kept: a part lying in
another part's hole gets its own spot. Don't rely on a board fitting its original `w`/`h`.
