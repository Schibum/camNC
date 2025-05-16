# TODO

# camnc

Camnc is a simple experimental web application that visualizes CNC G-code on a live camera feed (IP camera via [go2rtc](https://github.com/AlexxIT/go2rtc), old phone, webcam, etc.). It renders an orthographic 2D top-down view of the G-code on top of the camera image, adjusted for perspective effects through camera calibration and pose estimation.

## Features

- Overlay live G-code preview on a camera feed with perspective correction
- Integrated calibration tool (OpenCV) to estimate camera intrinsics
- Perspective-n-Point (PnP) pose estimation using machined wasteboard markers or ArUco markers
- Interactive zeroing and jogging via integration with FluidNC WebUI v3

## Requirements

- Camera, mounted so it has a clear view of the CNC table. E.g.:
  - Old smartphone
  - IP camera. Requires [go2rtc](https://github.com/AlexxIT/go2rtc) gateway to expose stream in a compatible way. Go2rtc can run on a Raspberry Pi Zero or any local machine
- (Optional) CNC controller with [FluidNC WebUI v3](http://wiki.fluidnc.com/en/features/webui). Does not work offline ATM, so fulidNC needs to run in STA mode.

## Usage

To get started, open the application at [https://camnc.vercel.app/](https://camnc.vercel.app/).
