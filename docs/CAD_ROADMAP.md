# CAD roadmap

Where camNC's integrated CAD goes after the sketcher: pockets, one 3D view, then
assembled flat parts and cupboards. Each PR below merges and ships on its own.
Tick a PR off here when it merges, and update the plan when the code proves it
wrong.

## Decisions

- **One 3D view.** Faces and regions are picked directly on the part, as in
  Onshape. There is no second view to keep in sync.
- **Top, underside and pocket floors first.** These only need polygons, so no
  geometry kernel is added. Sketching on edges is deferred, so end-grain holes
  wait too. Asking for edge cuts or angled joints is what reopens the kernel
  decision.
- **Parts and joints are the saved design.** A part holds an ordered feature list,
  and the document holds placements, joints and variables. Joints generate cuts.
- **A generator writes that same data.** It fills in a normal model and gets out
  of the way, so hand edits and later size changes both keep working.

## Constraints from the existing code

- `evaluateCadPart` treats every inner closed loop as a through-hole, and saved
  jobs rely on it. A loop stays a through-hole unless it is given a depth.
- A line across the outline makes a part invalid. A rabbet's region therefore
  comes from a separate sketch, with the part outline included when regions are
  worked out.
- `designGeometryKey` identifies what has been cut. Parts with no cuts must keep
  exactly the same key, or existing physical sheets would be flagged as out of date.
- `CadEditor` is a large SVG editor with many tests. To sketch on a face, the
  camera faces the surface and that editor is aligned on top of the 3D view. It is
  not rewritten in 3D.
- Floors, walls and top faces come straight from the stacked slabs, so each
  triangle can be tagged with its face for picking. No general boolean code is
  needed.

## Order

```
Pockets:   1 → 2 → 3 → 4 → first test cut
One view:  4 → 5 → 6 → 7
Assembly:  7 → 8 → 9 → 10 → 11 → 12 → 13
```

## Milestone 1: real pockets

Pockets that can be designed and cut, from the existing sketch editor.

### PR 1: Move sketch regions into the CAD package with stable IDs

`refactor(camNC) Move sketch regions into the CAD package with stable IDs`

- Move `sketchRegions.ts` into `@wbcnc/cad`. Each region's ID comes from its
  bounding curves and the side of each curve it lies on.
- The side matters because all three regions of two overlapping circles touch the
  same two curves. Regions with the same signature, such as the lenses between a
  wavy curve and a line, are told apart by their order along the curve.
- **Done when:** nothing visible changes, and IDs survive solving, dragging and
  reloading. Trimming a curve may change an ID, and PR 2 reports that.

### PR 2: Save cuts and face sketches on parts

`feat(cad) Save cuts and face sketches on parts`

- Add an optional ordered `features` list: sketches on a face (`top`, `underside`
  or `floorOf: cutId`), and cuts with a region and a depth or through.
- Evaluate these into `EvaluatedCadPart.cuts`, with errors for a missing region or
  a lost face. Regions report their nested islands here, because a cut needs them.
- Keep `version: 1` for documents with no features, and use `version: 2` for any
  with features, so an older build refuses the file and doesn't drop pockets.
- **Done when:** old documents round-trip byte for byte. There is no UI yet.

### PR 3: Send native pockets to CAM from polygons

`feat(cam) Send native pockets to CAM from polygons`

- Add `featuresFromCuts`, which builds levels, pockets and open-edge regions
  directly from polygons, keeping exact curves.
- Update `nativeCadModel.ts` to produce slab meshes and `shape.pockets`, and add
  cuts to the geometry key.
- **Done when:** results match `extractFeatures` on the same slab mesh, which is an
  independent check, and keys for parts without cuts are unchanged. Top side only.

### PR 4: Set pocket depth on a sketch region

`feat(camNC) Set pocket depth on a sketch region`

- Click a region in the sketch editor, then type a depth or choose Through or None.
  Shading shows the depth. PR 5 reuses this popup.
- Add a separate sketch for rabbets.
- **Done when:** a design with a recess, a slot and a rabbet goes from design to
  G-code in an end-to-end spec.

**Then do a physical test cut.** It doesn't block merging. Compare it with the
Fusion program for the same part, because no camNC program has been cut yet.

## Milestone 2: one 3D view

### PR 5: Edit cuts directly on the 3D part

`feat(camNC) Edit cuts directly on the 3D part`

- Add a 3D view to the Design step, with hover highlights, click-to-cut, a drag
  arrow, and a feature list with on/off and delete.
- **Done when:** a recess and a through slot can be made without opening the sketch
  editor.

### PR 6: Sketch on the top face and pocket floors

`feat(camNC) Sketch on the top face and pocket floors`

- Click a face, and the camera moves to face it with the editor aligned on top.
  Finish returns to 3D.
- Sketches on a floor follow the pocket's depth. If the pocket is removed, the part
  shows the lost face and offers a fix.
- Spike the alignment first, including zoom, pan and pointer accuracy at different
  window sizes. If it proves fragile, fall back to a quick transition into the
  full-screen sketch editor.
- **Done when:** a pocket inside a pocket works end to end, and 3D is the default
  view for parts.

### PR 7: Add underside sketches and cuts

`feat(camNC) Add underside sketches and cuts`

- Add the underside to the 3D view, with mirrored features passed to
  `flippedFeatures` in place of mesh extraction.
- Set `bottomFaces`, so the side B warning and plan appear.
- **Done when:** a part with cuts on both sides produces a correct side B plan, with
  holes in matching positions.

## Milestone 3: assembly and cupboards

### PR 8: Add design variables

`feat(cad) Add design variables`

- Add document variables such as `width` and `board`, used by dimensions and
  thickness. `dimensionExpressions.ts` is display-only today, so this makes
  expressions drive the solve.
- **Done when:** changing one variable updates every part that uses it, and an
  unsolvable value shows an error on that part and keeps the last good geometry.

### PR 9: Place parts in an assembly

`feat(camNC) Place parts in an assembly`

- Add a placement to each `CadPart`, plus "put this face against that face".
- Feed it into `ModelViewport`, whose assembled/flat toggle and `layoutFlat` exist,
  and add the exploded step.
- **Done when:** a two-part design shows assembled and flat, and placement changes
  alone never mark a physical sheet as out of date.

### PR 10: Add housing joints

`feat(cad) Add housing joints`

- Add a saved joint between two parts, starting with the housing joint because it
  only adds a pocket.
- Clearance comes from a variable. Dogbones use a design bit size, with a warning if
  the job's bit is bigger.
- **Done when:** a shelf housed in two sides stays correct when the width and board
  thickness change, and it sits in the pocket with the right clearance.

### PR 11: Add tab and mortise joints

`feat(cad) Add tab and mortise joints`

- Add tabs that change a part's outline and through-mortises on the other part, plus
  butt joints with screw holes.
- Keep the outline combining on the CAM side of the bridge, because `clipper2-ts` is
  only in `packages/cam`.
- **Done when:** a generated tab clears its mortise at the set clearance, and hand
  edits on those parts survive.

### PR 12: Add shelf and change-joint commands

`feat(camNC) Add shelf and change-joint commands`

- "Add shelf" creates a part, a placement and two joints. "Change all joints" skips
  any joint changed by hand. Moved shelves keep a rule, such as a set distance from
  the bottom.
- Show an error when a change makes an edit impossible, such as a hole falling off a
  panel or shelves colliding.
- **Done when:** adding a shelf, switching joints and adding a unit each work on a
  real document without further edits.

### PR 13: Add a cupboard generator

`feat(camNC) Add a cupboard generator`

- A form writes variables, fully constrained parts, placements and joints.
- **Done when:** you can generate a cupboard, move a shelf by hand, add a cable hole
  and change the width, and everything holds through to nesting on sheets.

## Not in this plan

- Sketching on edges, and angled joints.
- Fillets and STEP export.
- Orbiting while sketching.
- Undoing through feature history with a rollback slider.
- Rerunning a generator over edited parts.

## Riskiest points

- **PR 1:** if IDs aren't stable, cuts detach from their regions and everything after
  it is affected, so its tests should be the strictest.
- **PR 6:** see the fallback above.
- **PRs 2, 6 and 11** look like the largest, judged from reading the code.
