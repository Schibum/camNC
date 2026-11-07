# CAD browser regression recipes

These recipes exercise drawing, dimensions, editing, and stage navigation through
real Playwright pointer and keyboard input. They do not inject geometry or React
state. Each case starts in a fresh browser context; cases other than
`production-root` explicitly enter the simulated demo machine.

## Run

From the repository root, install dependencies and Chromium once, then start the
development server in another terminal:

```sh
pnpm install
pnpm --filter @wbcnc/camNC exec playwright install chromium
pnpm --filter @wbcnc/camNC dev --host 127.0.0.1 --port 5180
```

Run all 16 recipes:

```sh
pnpm --filter @wbcnc/camNC smoke:cad --url http://127.0.0.1:5180
```

For production verification, build the app and start its preview server, then
run the 13 cases that do not require development-source access:

```sh
pnpm --filter @wbcnc/camNC build
pnpm --filter @wbcnc/camNC preview --host 127.0.0.1 --port 5181
pnpm --filter @wbcnc/camNC smoke:cad --url http://127.0.0.1:5181 \
  --case about,production-root,free-sketch-growth,modification-tools,annotation-pan,conic,spline,bezier,periodic-spline,responsive,capsule-edit,corbel-edit,jigsaw-edit
```

Options:

- `--list`: list cases without launching a browser.
- `--case NAME[,NAME...]`: choose cases; `all` runs every case.
- `--url URL`: application origin; default `http://127.0.0.1:5180/`.
- `--output DIR`: artifact directory; default repository `output/playwright/cad-acceptance/`, ignored by Git.
- `--headed`: show the Chromium browser.

The runner closes every browser context, records console and page errors, and
writes JSON results, screenshots, and a Playwright trace per case. It exits
nonzero if any case fails. The fresh local root case checks keyless startup; it
does not verify a configured production sign-in service.

## Cases

| Case                 | Coverage                                                                                                    |
| -------------------- | ----------------------------------------------------------------------------------------------------------- |
| `about`              | App navigation, keyboard license disclosure, shipped license/source checksums, and narrow layout.           |
| `production-root`    | Fresh keyless startup, demo entry, a rectangle with a hole, solver startup, Boards, and Design reentry.     |
| `free-sketch-growth` | Drag-created rectangle, unconfirmed value acceptance, fitted-board growth, placement retention, and reload. |
| `modification-tools` | Linked signed Offset, Mirror dimension propagation, line/arc Extend, preview weights, undo, and reload.     |
| `annotation-pan`     | Right/middle drags over Coincident and conic-rho annotations without changing source geometry.              |
| `shelf`              | Eight-edge closed outline, driving dimensions, shared-radius corner fillets, shading, and reentry.          |
| `shelf-open`         | Open line fixtures, exact decimal dimensions, point-aware Trim, selection, undo, and draft reentry.         |
| `conic`              | Rho focus and editing, control-point drag, undo/redo, closure, and reentry.                                 |
| `spline`             | Fit points and endpoint handles, fit insertion, drags, undo/redo, closure, and reentry.                     |
| `bezier`             | Control drag, polygon-based control insertion, undo/redo, closure, and reentry.                             |
| `periodic-spline`    | Closed analytic curve, seam drag, region retention, and reentry.                                            |
| `responsive`         | Five viewport widths, tool families, family memory, and keyboard menu activation.                           |
| `capsule-edit`       | Replace a dimensioned side with a notch; retain unrelated dimensions and geometry identity.                 |
| `corbel-edit`        | Replace a rounded corner with a chamfer and a different arc, then redimension and reenter.                  |
| `jigsaw-edit`        | Replace a major arc with two lines, redimension, and retain closure through reentry.                        |
| `basics-source`      | Line/arc chaining, explicit-point Trim, drag joining, marquee selection, regions, and batch fillets.        |

`shelf`, `shelf-open`, and `basics-source` perform development-only, read-only
inspection of the already-loaded `jobDb` module after UI actions. They do not
write the source graph. The runner explicitly rejects a production server for
these cases. All other cases use public DOM/SVG evidence.

## License distribution checks

`pnpm --filter @wbcnc/camNC test:licenses` checks omission and corruption failures.
The normal app build runs `check-distribution.mjs` against the actual `dist`,
checking notices, full licenses, the pinned source archive, and the separate WASM
binary. Canonical files are in `packages/cad/licenses` and
`packages/cad/THIRD_PARTY_NOTICES.md`; app copies are served from
`/licenses/planegcs/`. Update both copies and the provenance manifest when the
solver dependency changes. Third-party attribution and license contents are
independent of these regression recipes.

See [CAD status](../../../../docs/CAD_STATUS.md) for supported tools and current
limits, and the [declarative behavior specs](../spec/README.md) for the separate
scenario runner and reviewed SVG goldens.
