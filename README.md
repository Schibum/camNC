# camNC Monorepo

This repository is a pnpm/Turborepo workspace that contains the **camNC**
application and a collection of supporting packages.

CamNC is a simple experimental web application that visualizes CNC G-code on a live camera feed (IP camera via [go2rtc](https://github.com/AlexxIT/go2rtc), old phone, webcam, etc.). It renders an orthographic 2D top-down view of the G-code on top of the camera image, adjusted for perspective effects through camera calibration and pose estimation.

## Features

- Overlay live G-code preview on a camera feed with perspective correction
- Integrated calibration tool (OpenCV) to estimate camera intrinsics
- Perspective-n-Point (PnP) pose estimation using ArUco markers
- Built-in machine control for FluidNC (3.9.9 and 4.1.x) over a direct WebSocket: DRO, jogging, zeroing, Z probing, overrides, macros, SD jobs with progress on the toolpath, and a console

## Requirements

- Camera, mounted so it has a clear view of the CNC table. E.g.:
  - Old smartphone
    - [Ceiling mount 3d print model](https://makerworld.com/en/models/1455114-ceiling-top-down-phone-mount-with-ball-joint#profileId-1516416)
  - IP camera. Requires [go2rtc](https://github.com/AlexxIT/go2rtc) gateway to expose stream in a compatible way. Go2rtc can run on a Raspberry Pi Zero or any local machine.
    - [Reolink E1 Zoom 3d print model](https://makerworld.com/en/models/1461605-reolink-e1-zoom-ceiling-down-mount-looking-down#profileId-1524062)

- (Optional) CNC controller running [FluidNC](http://wiki.fluidnc.com/) 3.9.9 or 4.1.x (reference: V1 Engineering Jackpot2 on a LowRider V4). Machine control needs Chrome or Edge 147+, and browser and controller must be on the same LAN (FluidNC in STA mode). Other browsers can use camNC as a viewer.

## Usage

To get started, open the application at [https://run.camnc.app/](https://run.camnc.app/).

### Screenshots

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
- **webrtc-cam** – runs on a phone and streams its camera to camNC via WebRTC.
- **website** – Astro landing page ([www.camnc.app](https://www.camnc.app/)).
- **chessboard** – displays/prints the chessboard pattern for camera calibration.
- **demos** – sandbox showcasing individual packages.

### Packages

- **camera-calibration** – React components, store and workers for calibrating a camera with OpenCV.
- **fluidnc** – direct WebSocket connection to FluidNC (transport detection, command queue, parsers, uploads), a scripted fake and the `pnpm sim` FluidNC simulator.
- **go2webrtc** – video sources (go2rtc, phone via WebRTC, WebTorrent, webcam, URL).
- **webrtc-channel** – WebRTC peer, Firebase signalling and data channel helpers.
- **video-worker-utils** – helpers for processing video frames in web workers.
- **load-opencv** – loads OpenCV.js in the browser.
- **ui** – shared React UI components.
- **public-config** – shared Firebase configuration.
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
