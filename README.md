# camNC

camNC shows your CNC toolpath on a live camera image of the machine bed, so you can check stock placement, offsets and
clamps before the spindle starts. Mount a camera above the machine (an old phone, a webcam or an IP camera), print four
ArUco markers, and camNC turns the camera's perspective view into a calibrated, top-down view in machine coordinates with
the G-code drawn on top.

This repository is a pnpm/Turborepo monorepo with the camNC app, its desktop version and the supporting packages.

## Features

- Overlay the G-code toolpath on a live camera feed, corrected for lens distortion and perspective
- Built-in camera calibration (OpenCV) and pose estimation from four ArUco markers
- Machine control for FluidNC (3.9.9 and 4.1.x): DRO, jogging, zeroing, Z probing, overrides, macros, SD jobs with
  progress on the toolpath, and a console
- Optional "hide machine" mode that masks the gantry out of the image using monocular depth estimation

## Getting started

**Try it first:** the [demo](https://run.camnc.app/demo) runs in your browser with a recorded machine camera, a sample
job and a simulated FluidNC. You can load your own G-code, and nothing is saved.

To use camNC with your own machine, pick one of these:

### Desktop app (recommended)

Download the installer for macOS (Apple silicon), Windows or Linux (`.deb`) from the
[latest release](https://github.com/Schibum/camNC/releases/latest).

The desktop app is camNC with its own Chromium built in. It finds IP cameras on your network (ONVIF, or any camera with
RTSP) and connects to them directly, so you don't need a Raspberry Pi, go2rtc or any other gateway. It also talks to
FluidNC without browser restrictions and works offline. On macOS and Windows it updates itself in the background (the
update is used after the next restart); on Linux, install a newer `.deb` from the releases.

The app is not code-signed yet, so the first start shows a warning:

- **macOS:** open the app once, then allow it under System Settings → Privacy & Security → _Open Anyway_. Or run
  `xattr -dr com.apple.quarantine /Applications/camNC.app`.
- **Windows:** SmartScreen warns about an unknown publisher; choose _More info_ → _Run anyway_.

Settings stay on your computer; there is no sign-in or sync in the desktop app. See
[apps/camnc-desktop](apps/camnc-desktop/README.md) for building it yourself.

### In the browser

Open [run.camnc.app](https://run.camnc.app/), no install needed. Phone cameras and webcams work out of the box. For
machine control, use Chrome or Edge 147+ on the same network as the controller (FluidNC in STA mode); other browsers can
use camNC as a viewer.

Browsers can't open an IP camera's RTSP stream. To use an IP camera in the browser, run a
[go2rtc](https://github.com/AlexxIT/go2rtc) gateway that re-streams it over WebRTC, for example on a Raspberry Pi Zero
or any computer on your network, and pick the _go2rtc_ source in camNC. The desktop app makes this unnecessary.

## What you need

| Part                        | Notes                                                                                                                                                                                                                                                                                                                   |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Camera with a top-down view | An old smartphone ([ceiling mount](https://makerworld.com/en/models/1455114-ceiling-top-down-phone-mount-with-ball-joint#profileId-1516416)), a webcam, or an IP camera such as a Reolink E1 Zoom ([mount](https://makerworld.com/en/models/1461605-reolink-e1-zoom-ceiling-down-mount-looking-down#profileId-1524062)) |
| Four ArUco markers          | Printed and fixed at known machine positions; camNC uses them to find the camera pose and keep it up to date                                                                                                                                                                                                            |
| Calibration chessboard      | Printed or shown on a screen, used once per camera during setup                                                                                                                                                                                                                                                         |
| FluidNC controller          | Optional. 3.9.9 or 4.1.x, for machine control (reference machine: V1 Engineering Jackpot2 on a LowRider V4)                                                                                                                                                                                                             |

## Screenshots

Original camera image from a Reolink E1 Zoom. Note the lens distortion and perspective - both are compensated, so you get an orthographic top down view instead for the overlays:

<img width="1339" alt="Screenshot 2025-06-04 at 16 04 00" src="https://github.com/user-attachments/assets/39062592-b1a4-4a1c-abfd-be1a90b5517b" />

Example overlays:

<img width="473" alt="Screenshot 2025-06-04 at 11 52 41" src="https://github.com/user-attachments/assets/7de1504d-b0ca-4db3-bff7-a958a1131071" />

https://github.com/user-attachments/assets/a38d152a-4533-4eb4-9d5e-f3c68fd1d5c0

This demonstrates engraving a cross positioned via drag-and-drop in the camera stream, aiming to align three successive crosses. The results show a Y-axis deviation of 1–2 mm, while the X-axis aligns well. The setup used an old Pixel 5 and a ~120×60 cm [MPCNC Lowrider V4](https://docs.v1e.com/lowrider/) build, with a reprojection error of around 2:

https://github.com/user-attachments/assets/0c16f067-9cb2-4bc9-9941-f04e23f4bc24

Hide-machine feature:
This experimental feature estimates monocular depth using the Depth Anything V2 model to mask objects above the work surface and "hide" the machine (only tested with the [LowRider V4 beam](https://docs.v1e.com/lowrider/)). Assumes the largest depth cluster is the table and masks everything above a configurable offset:

https://github.com/user-attachments/assets/a89cd4fe-92ce-4c37-b2a1-7ad5d3012fee

Example cutting a small board:

[![cutting oak](https://img.youtube.com/vi/KKgJ9J6dmqE/0.jpg)](https://www.youtube.com/watch?v=KKgJ9J6dmqE)

## Repository layout

This workspace is a pnpm/Turborepo monorepo split into two top‑level folders:

- `apps/` – runnable applications.
- `packages/` – reusable libraries and config used by the apps.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for how the pieces fit together.

### Apps

- **camNC** – main camera overlay application ([run.camnc.app](https://run.camnc.app/)).
- **camnc-desktop** – the desktop app: camNC packaged with Tauri and CEF, with a go2rtc sidecar for IP cameras.
- **webrtc-cam** – runs on a phone and streams its camera to camNC via WebRTC.
- **website** – Astro landing page ([www.camnc.app](https://www.camnc.app/)).
- **chessboard** – displays/prints the chessboard pattern for camera calibration.
- **demos** – sandbox showcasing individual packages.
- **signal** – Cloudflare Worker that relays WebRTC signalling between camNC and phone cameras.

### Packages

- **camera-calibration** – React components, store and workers for calibrating a camera with OpenCV.
- **fluidnc** – direct WebSocket connection to FluidNC (transport detection, command queue, parsers, uploads), a scripted fake and the `pnpm sim` FluidNC simulator.
- **go2webrtc** – video sources (go2rtc, RTSP via the desktop app's go2rtc, phone via WebRTC, WebTorrent, webcam, URL).
- **webrtc-channel** – WebRTC peer, WebSocket signalling client and data channel helpers.
- **video-worker-utils** – helpers for processing video frames in web workers.
- **load-opencv** – loads OpenCV.js in the browser.
- **ui** – shared React UI components.
- **public-config** – shared public configuration (signalling URL).
- **eslint-config**, **typescript-config** – shared lint rules and tsconfig presets.

## Development

Requirements: Node.js (see [`.nvmrc`](.nvmrc), `^20.19` or `>=22.12`) and pnpm (version pinned in `package.json`,
e.g. via `corepack enable`).

```bash
pnpm install
# Start a single app, e.g. camNC (see apps/camNC/README.md for required env vars)
pnpm dev --filter @wbcnc/camNC
# Or start all apps at once
pnpm dev
```

Checks (also run in CI):

```bash
pnpm run check-format  # prettier (a pre-commit hook formats staged files)
pnpm run lint          # eslint
pnpm run check-types   # tsc --noEmit in every package
pnpm run test          # vitest, runs in headless Chromium via Playwright
pnpm run build
```

Tests run in the browser, so install Chromium once with `pnpm exec playwright install chromium`. Run a single
package's tests with `pnpm turbo run test --filter <package>`.
