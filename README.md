# camNC Monorepo

This repository is a pnpm/Turborepo workspace that contains the **camNC**
application and a collection of supporting packages.

CamNC is a simple experimental web application that visualizes CNC G-code on a live camera feed (IP camera via [go2rtc](https://github.com/AlexxIT/go2rtc), old phone, webcam, etc.). It renders an orthographic 2D top-down view of the G-code on top of the camera image, adjusted for perspective effects through camera calibration and pose estimation.

## Features

- Overlay live G-code preview on a camera feed with perspective correction
- Integrated calibration tool (OpenCV) to estimate camera intrinsics
- Perspective-n-Point (PnP) pose estimation using machined wasteboard markers or ArUco markers
- Interactive zeroing and jogging via integration with FluidNC WebUI v3

## Requirements

- Camera, mounted so it has a clear view of the CNC table. E.g.:
  - Old smartphone
    - [Ceiling mount 3d print model](https://makerworld.com/en/models/1455114-ceiling-top-down-phone-mount-with-ball-joint#profileId-1516416)
  - IP camera. Requires [go2rtc](https://github.com/AlexxIT/go2rtc) gateway to expose stream in a compatible way. Go2rtc can run on a Raspberry Pi Zero or any local machine.
    - [Reolink E1 Zoom 3d print model](https://makerworld.com/en/models/1461605-reolink-e1-zoom-ceiling-down-mount-looking-down#profileId-1524062)
- (Optional) CNC controller with [FluidNC WebUI v3](http://wiki.fluidnc.com/en/features/webui). Does not work offline ATM, so fulidNC needs to run in STA mode.

## Usage

To get started, open the application at [https://camnc.vercel.app/](https://camnc.vercel.app/).

## Repository layout

This workspace is split into two top‑level folders:

- `apps/` – runnable applications.
- `packages/` – reusable libraries and config used by the apps.

### Apps

- **camNC** – main camera overlay application.
- **chessboard** – printable chessboard pattern for camera calibration.
- **demos** – sandbox showcasing individual packages.
- **fluidnc-integration** – prototype FluidNC control UI.
- **webrtc-cam** – minimal browser client for go2rtc.

### Packages

- **camera-calibration** – React components for calibrating a camera.
- **eslint-config** – shared eslint rules.
- **fluidnc-api** – small API wrapper for FluidNC.
- **go2webrtc** – utilities for connecting to go2rtc via WebRTC.
- **load-opencv** – helper for loading OpenCV in the browser.
- **public-config** – shared Firebase configuration.
- **typescript-config** – common tsconfig presets.
- **ui** – shared React UI components.
- **webrtc-channel** – abstraction over WebRTC data channels.

## Development

Install dependencies and start all apps in dev mode:

```bash
pnpm install
pnpm run dev
```

Other useful commands:

```bash
pnpm run lint   # run eslint across the workspace
pnpm run test   # run vitest suites
```
