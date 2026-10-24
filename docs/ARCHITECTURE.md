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
 (go2rtc, phone,     (shared,         (machine XY → K[R|t]      + toolpath plane
  webcam, URL)        ref-counted)     → distort → sample)        + markers, machine pos
```

## Workspace layout

| Path                                                   | Purpose                                                                                                         |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| `apps/camNC`                                           | Main app (TanStack Start, React 19, react-three-fiber).                                                         |
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
  the server for signed-in users (`src/db`, Clerk + Drizzle/Neon via TanStack
  Start server functions).
- `src/store/store-p3p.ts` – marker detection on averaged still frames and
  extrinsics recomputation.
- `src/lib/fluidnc` – `CncApi`, a Preact-signals based wrapper around
  `FluidncProtocol` (connection state, status, offsets, alarms, console), and
  `getCncApi()`, which follows the machine host stored in the settings.
- `src/components/machine` – the machine UI: status bar, connection step and
  the machine panel (DRO, jog, zero, probe, overrides, job, SD files, macros,
  console, config).

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
