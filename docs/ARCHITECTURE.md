# Architecture

This document gives a high-level overview of how camNC works and how the
workspace is organised. See the [README](../README.md) for setup instructions.

## Overview

camNC renders an orthographic, top-down view of the CNC work area from a
perspective camera image and draws the G-code toolpath on top of it. To do so it
needs two things for every camera:

1. **Intrinsics** (camera matrix `K` and lens distortion), estimated once by
   filming a chessboard (`@wbcnc/camera-calibration`, OpenCV
   `calibrateCamera`).
2. **Extrinsics** (rotation `R` and translation `t` from machine to camera
   coordinates), estimated by detecting four ArUco markers at known machine
   positions and solving a Perspective-n-Point problem (OpenCV `solvePnP` with
   `SOLVEPNP_SQPNP`).

With both, every point `X` on the machine plane can be projected into the
camera image: `x = K · (R · X + t)`, followed by applying lens distortion. The
renderer does this per fragment, so the camera image is effectively re-sampled
into machine coordinates.

```
 camera source ──► video element ──► CameraShaderMaterial ──► orthographic r3f scene
 (go2rtc, RTSP*,     (shared,         (machine XY → K[R|t]      + toolpath plane
  phone, webcam,      ref-counted)     → distort → sample)        + markers, machine pos
  URL)

 * desktop app only, through its go2rtc sidecar
```

## Workspace layout

| Path                                                   | Purpose                                                                                                         |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| `apps/camNC`                                           | Main app (TanStack Router, React 19, react-three-fiber), served by a Cloudflare Worker.                         |
| `apps/camnc-desktop`                                   | Desktop app: `apps/camNC` in Tauri 3 + CEF, with camera discovery, a go2rtc sidecar and native sockets.         |
| `apps/webrtc-cam`                                      | Runs on a phone: streams its camera to camNC over WebRTC.                                                       |
| `apps/website`                                         | Astro landing page (www.camnc.app).                                                                             |
| `apps/chessboard`                                      | Static page that displays/prints the calibration chessboard.                                                    |
| `apps/demos`                                           | Sandbox pages for individual packages.                                                                          |
| `apps/signal`                                          | Cloudflare Worker + Durable Object relaying WebRTC signalling between peers in a room.                          |
| `packages/camera-calibration`                          | Chessboard calibration UI, zustand store and workers (corner finding, pose uniqueness, `calibrateCamera`).      |
| `packages/go2webrtc`                                   | Video source abstraction: go2rtc (WebSocket/WebRTC), phone (`webrtc:`), WebTorrent tracker, webcam and URLs.    |
| `packages/webrtc-channel`                              | `Peer` (perfect negotiation), `WsSignaller`, `RolePeering`, chunked data channel, Comlink middleware.           |
| `packages/fluidnc`                                     | Direct FluidNC WebSocket: `FluidncSocket`, `FluidncProtocol`, parsers, uploads, `FakeFluidnc`, `pnpm sim`.      |
| `packages/video-worker-utils`                          | Helpers to move video into workers (`MediaStreamTrackProcessor` + polyfill), three.js Comlink transfer handler. |
| `packages/load-opencv`                                 | Loads the OpenCV.js WASM build from `/opencv_js.js` and exposes a typed `cv2` proxy.                            |
| `packages/ui`                                          | Shared shadcn/radix components, hooks and theme provider.                                                       |
| `packages/public-config`                               | Public configuration, e.g. the WebRTC signalling URL.                                                           |
| `packages/eslint-config`, `packages/typescript-config` | Shared lint and TypeScript presets.                                                                             |

Packages are consumed as TypeScript source (no build step); each app's Vite
build compiles them.

## camNC app

### Routes and setup flow

File-based routes live in `apps/camNC/src/routes` (`routeTree.gen.ts` is
generated, don't edit it). New cameras go through the setup wizard:

1. `setup/url-entry` – choose the video source and its resolution.
2. `setup/camera-calibration` – estimate intrinsics with a chessboard.
3. `setup/machine-bounds` – usable machine area (optionally read from the
   the running FluidNC config via `$Config/Dump`).
4. `setup/marker-positions` – machine coordinates of the four ArUco markers
   (ids 0–3).
5. `setup/point-selection` – detect the markers in the camera image and solve
   PnP for the extrinsics.

`visualize/2DView` is the main view. Debug routes live under `routes/debug`.

### State

- `src/store/store.ts` – a single zustand store (immer, `persist`,
  `subscribeWithSelector`). Camera settings are stored per camera in
  `camSources` keyed by id, with `activeCamId` selecting the current one.
  Matrices and vectors are three.js objects, serialised with superjson
  (`store-storage.ts`). Settings are persisted to localStorage and synced to
  the server for signed-in users (`src/lib/settings-sync`, talking to the
  `/api` routes of the app's Cloudflare Worker in `worker/`, which stores them
  in D1 via Drizzle; sign-in with Clerk). The desktop app has no sign-in and
  keeps settings local.
- `src/store/store-p3p.ts` – marker detection on averaged still frames and
  extrinsics recomputation.
- `src/lib/fluidnc` – `CncApi`, a Preact-signals based wrapper around
  `FluidncProtocol` (connection state, status, offsets, alarms, console), and
  `getCncApi()`, which follows the machine host stored in the settings.
- `src/components/machine` – the machine UI: status bar, connection step and
  the machine panel (DRO, jog, zero, probe, overrides, job, SD files, macros,
  console, config).

### Built-in CAM

`packages/cam` imports STEP/STL geometry, detects flat parts and generates
board toolpaths and FluidNC G-code. Part grouping verifies geometry including
depth; bounding boxes and vertex moments only narrow the candidates.
Groups retain their source body references, so repeated CAD names cannot
associate a display mesh with another machining part.
Toolpaths carry absolute safe/retract Z values, derived from the stock top,
configured clearance and any hold-down hardware, through program splitting
and guided tab removal.

`src/cam/jobDb.ts` stores CAM jobs and their model bytes in IndexedDB, separate
from app settings. A model's identity includes the job id, filename and model
revision. Imports run asynchronously in `workers/cam.worker.ts`; their saved
results must still belong to an existing job with that model identity. The
identity check and update share a read/write transaction, so an old import
cannot overwrite a replacement or recreate a deleted job. React Query holds
the open job and model results; cache publication also respects newer edits.
An import already saved by another tab refreshes the cache without another
database write. Changed part fingerprints trigger shape matching and board
remapping even if an importer update leaves the file revision unchanged.
User saves carry the snapshot they edited, so the database transaction applies
only their changes onto the current job and retains import results committed
meanwhile. Demo jobs use an isolated in-memory equivalent.

### Native 2D CAD

`packages/cad` owns the editable document and geometry independently of React,
CAM and the native solver. All coordinates are millimetres. Permanent part,
entity and constraint IDs carry identity through edits; coordinates and array
positions do not identify objects. Source curves remain analytic: lines,
circles, arcs, rational conics, Bezier curves and interpolating B-splines.
Tessellation is an evaluated output for display and cutting.

`solver.ts` adapts the source to PlaneGCS WASM. Native B-spline equations retain
fit points and independent endpoint tangent handles. Solved results undergo
geometric and curve-equation checks before publication. The app calls the
solver through one lazy worker (`src/cad/solveCad.ts`); source revision checks
prevent a delayed result from replacing a later edit or drag preview.

Shared geometry services keep editing operations consistent:

`splineHandles.ts` gives structural tangent segments explicit parent ownership
without adding points or degrees of freedom. `rectangleCorners.ts` creates
independent edge endpoints joined by removable Coincident relations; matching
coordinates do not create identity. `offsetGeometry.ts` shares directed-support
construction and intersections between command creation and detached native
seeds. These services preserve source IDs and driver ownership without turning
numerical seed choices into permanent source fixation.

- `pointEquivalence.ts` derives transitive coincidence groups without merging
  source IDs or losing dimension ownership. Fillet, tangency, constraints and
  drag snapping use the same groups.
- `curveContacts.ts` supplies finite primitive and rational-curve contacts in
  model units. Both cutting validation and Trim use this service. Proven
  circular overlap is distinguished from isolated intersections; an ambiguous
  or overly complex trim leaves the source unchanged.
- `curves.ts` owns curve evaluation, rational spans, adaptive tessellation and
  shape-preserving insertion. Curve display, picking and CAM use this source.
- `fillet.ts` performs an atomic batch of line-corner fillets. A shared radius
  and equal constraints keep that batch editable. Virtual sharp construction
  points preserve dimensions on the original line extensions.
- `dimensionPlacement.ts` captures and resolves annotations in their measured
  geometry's frame. Linear span fractions, radial ratios, and angular radius
  and phase remain independent of camera scale and solver equations. Legacy
  absolute labels normalize before point or value edits and solving. Rendering
  uses the live geometry; history and portable documents retain the placement.
  Outside-span labels retain a fixed overshoot. Radial labels use a bounded
  radius gain plus a fixed outward gap, so distant placements remain continuous
  as a radius changes. Gains up to four retain proportional placement; excess
  placement becomes a fixed gap, bounding the label at two diameters plus that
  gap. Remote angle intersections ease into a local centre;
  labels and decorations share that continuous frame, including at parallel
  lines. Placement normalization never replaces a valid ratio merely because
  its current radius is small.

`apps/camNC/src/cad` owns pointer and keyboard interaction, screen-space picking,
inference previews, inline annotations, selection and command history. Drawing
and drag snapping share inference rules. A drop creates a persistent relation
only after a native-solved preview reaches the inferred target. Drag and
creation-value entry each form a single undoable command. `drawingGesture.ts`
owns the pure press/click/drag transition for primitives; dimension reference
collection, value expressions, annotation geometry, inference and selection
also live outside the React editor.

`CadValueInput.tsx` shares unit-aware suffixes across value fields. The expression
lexer identifies explicit units while typing. A shared core literal classifier
also normalizes saved base-unit expressions. Content comparisons canonicalize
these representation upgrades without advancing CAM revisions; optimistic save
guards still compare the exact durable snapshot.

`session.ts` retains up to 100 document snapshots across route changes and
Finish. Acceptance advances Cancel's baseline without clearing Undo; explicit
Cancel ends the session. The session keeps the exact durable draft it
acknowledged separately from local work. A stale view cannot save against a
newer draft; recovery explicitly saves a sketch copy or adopts the saved
source. Drafts live in the job database; undo history remains session-local.

Sketch shading and cutting validation have different jobs. `sketchRegions` in
`@wbcnc/cad` builds an arrangement of every bounded face, including nested
regions and closed areas beside open geometry, and the sketch shades them. Each
region has a stable ID from its bounding curves and the side of each it lies on.
`evaluateCadPart` requires a valid closed cutting profile and classifies material
holes. Gray shading alone does not enable Finish.

`src/cam/cadDesign.ts` separates saved drafts from accepted CAM geometry.
Accepting a solved design preserves CAM settings by permanent part ID, carries
placements and tab anchors, and increments only affected part revisions.
`nativeCadModel.ts` converts evaluated outlines into the existing flat-part
CAM interface. A draft can therefore be incomplete without invalidating the
last accepted manufacturing geometry.

The initial scope is flat through-cuts. Fillet currently supports line-to-line
corners; Trim targets lines, circles and arcs, with rational curves usable as
boundaries. Pockets and 3D operations remain future work. Further changes should
extend the source model and geometry services first, then add interaction
commands. The main remaining structural improvement is extracting the editor's
large pointer/tool state machine into explicit commands; avoid a second solver,
parallel intersection implementations or compatibility layers for old sketches.

### Manufacturing ownership

Editable design, accepted CAM geometry and an execution are separate lifetimes.
The job database owns durable drafts, accepted geometry and board history;
React Query holds a projection of that data. A pending model is not an empty
board list. A first action on newly derived stock persists that stock with the
action, against the latest durable source.

A logical board ID preserves layout and CAM references. `physicalSheetId`
identifies the actual sheet occupying that board; Start over replaces this
identity. `runId` identifies a pinned machining setup, while `executionId`
identifies each controller dispatch, including resumes. These identities must
not be inferred from identical geometry, program text or timestamps. Delayed
completion and setup writes carry their originating identities and cannot
modify replacement stock or a later execution.

`manufacturingSnapshot.ts` captures the original queue, geometry and settings.
`camMachine.ts` centralizes the protection shared by UI controls and direct
commands. Physical activity, resumability, discovery and explicit run review
are distinct states; an idle controller alone does not release the original
sheet or authorize replacing its setup.

`jobRecord.ts` owns conditional receipt/progress transactions. Preparation
reserves a durable head without claiming that its uploaded program ran; only
the prior eligible receipt is recoverable until activation. Each execution
uploads to its own immutable SD filename. The caller captures controller,
storage namespace, work offset and settings before awaits, then checks that
context again immediately before dispatch. A controller result settles only
the receipt observed running, using current file and work-offset evidence.

Keep these services independent of the sketch editor. Further simplification
should move asynchronous orchestration into an explicit execution state
machine using these identities and storage commands, rather than adding
separate locks in each screen or reconstructing history from the current CAM
model. Do not combine the accepted design revision with physical sheet
history: editing a sketch does not replace stock that has already been cut.

### Rendering

`scene/PresentCanvas.tsx` sets up an orthographic react-three-fiber canvas in
machine coordinates (mm). `calibration/CameraShaderMaterial.tsx` projects each
fragment of the machine plane into the camera image (`K`, `R`, `t` and
distortion coefficients as uniforms) and samples the video texture. The parsed
G-code (`visualize/gcodeParsing.ts`, based on `gcode-toolpath`) is drawn into a
canvas texture on a plane above it (`visualize/ToolpathCanvasPlane.tsx`).

### Workers and GPU pipelines

- `workers/markerScanner.worker.ts` – periodically detects ArUco markers in the
  live stream to keep the extrinsics up to date (`hooks/useAutoScanMarkers.ts`).
- `depth/` – optional "hide machine" pipeline: a WebGPU worker warps frames
  into machine space, estimates depth with Depth Anything V2
  (transformers.js), builds a mask for everything above the table and returns
  mask/background bitmaps that the shader blends in
  (`depth/depthBlendManager.ts`).
- Video frames reach workers as `ReadableStream<VideoFrame>`s via
  `@wbcnc/video-worker-utils`; Comlink is used for RPC.

OpenCV.js is large, so it is loaded lazily (`ensureOpenCvIsLoaded()`), and
hot paths that run on startup (e.g. the undistortion map in
`calibration/rectifyMap.ts`) are reimplemented in plain TypeScript and tested
against OpenCV.

## Remote connections

The phone camera is reached over WebRTC (`@wbcnc/webrtc-channel`). Peers find
each other through `apps/signal`, a Worker with one Durable Object per room
(named by a hash of the shared access token), and switch to in-band signalling
over their data channel once connected. The CNC controller is reached directly.

- **Phone camera**: `apps/webrtc-cam` runs on the phone and serves its
  `getUserMedia` stream (`useTrysteroServer`); camNC connects with a
  `webrtc:?accessToken=…` source URL. Comlink messages over data channels go through `createChunkedPort`, which
  splits large messages into 16 KiB chunks.
- **FluidNC**: camNC opens a WebSocket straight to the controller on the LAN
  (`@wbcnc/fluidnc`). FluidNC 4.x serves it on the HTTP port
  (`ws://<ip>/?independent_session`), 3.9.9 on HTTP port + 1
  (`ws://<ip>:81/`, the WebUI v2 socket; port + 2 would kick the WebUI). The
  variant is detected on connect and remembered. From `https://run.camnc.app`
  this relies on Chrome/Edge 147+ Local Network Access, which also lifts
  mixed-content blocking once the user allows it. Uploads are `no-cors` POSTs
  to `/upload` (FluidNC sends no CORS headers), verified with `$SD/ListJSON`;
  XMODEM over the socket is the fallback. Only one tab holds the connection
  (Web Locks), and nothing is re-sent after a reconnect.

Connection attempts belong to a generation: stopping cancels pending sockets,
and a completed handshake from an older generation cannot attach after a
restart. During XMODEM, the transfer owns the raw byte stream and command slot.
Any text received after its final binary ACK is returned to the line parser
before the command queue resumes.

## Desktop app

`apps/camnc-desktop` wraps the built web app (`apps/camNC/dist`) in Tauri 3 with
the CEF runtime, so it runs the same Chromium on macOS, Windows and Linux. The
web code checks `isDesktopApp()` and, at startup, `initDesktopApp()`
(`apps/camNC/src/lib/desktop`) swaps in native pieces:

- **IP cameras**: the _Network camera_ setup tab calls the Rust side to find
  cameras (`src-tauri/src/discovery.rs`: ONVIF WS-Discovery, plus a scan of the
  local /24 for RTSP port 554) and to ask ONVIF cameras for their stream URLs.
  An `rtsp:` source is resolved through `setRtspGateway` (`@wbcnc/go2webrtc`):
  the app writes the camera into the config of a bundled go2rtc
  (`src-tauri/src/go2rtc.rs`), which listens on `127.0.0.1` and serves the
  stream over its WebRTC WebSocket like any go2rtc source.
- **FluidNC**: `desktopMachineTransport` routes the controller WebSocket and
  uploads through `tauri-plugin-websocket` and `tauri-plugin-http`, so Local
  Network Access and mixed-content rules don't apply.
- **Updates**: `src-tauri/src/updater.rs` and `lib/desktop/updates.ts` check
  the signed `latest.json` of the rolling release and offer a restart.

See [apps/camnc-desktop/README.md](../apps/camnc-desktop/README.md) for builds
and releases.

## Testing

`packages/fluidnc` tests run in Node against `FakeFluidnc` (transcripts in
`src/testing/transcripts`). `pnpm --filter @wbcnc/fluidnc sim [--v3]` starts the
real FluidNC 4.1.1 posix simulator with the JP2 LowRider config (plus a
3.9.9 transport proxy), and `src/sim.integration.test.ts` runs against it when
`FLUIDNC_SIM_HOST` is set (CI job `fluidnc-sim`).

Other tests use Vitest in browser mode (Playwright/Chromium) because they depend on
browser APIs such as OpenCV's WASM build, `VideoFrame` and WebRTC. Pure logic
is tested next to the source (`*.test.ts`). WebRTC integration tests
signal through an in-memory hub (`test-utils/local-signal-hub.ts`); the signal
worker is tested in workerd (`@cloudflare/vitest-pool-workers`).
