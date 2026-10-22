# WebRTC Cam

Turns a phone (or any device with a browser and camera) into a camera source
for camNC. It captures the camera with `getUserMedia` and streams it over
WebRTC (`@wbcnc/go2webrtc`); camNC links to it from the "Phone" video source
tab.

```bash
pnpm dev --filter @wbcnc/webrtc-cam   # from the repo root
```
