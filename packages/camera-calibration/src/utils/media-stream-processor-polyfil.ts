// Mozilla polyfill for MediaStreamTrackProcessor
// From https://jan-ivar.github.io/polyfills/mediastreamtrackprocessor.js
// @ts-nocheck

import { isFirefox } from "react-device-detect";

// Note: Chrome has native support, but only on the main thread against spec.
// Firefox has no support and does not support transferable tracks.
// Safari has native support on the worker thread and does suppor transferable tracks.
// Only add this polyfill for Firefox. Prefer using transferable tracks on
// Safari (used when not present on the main thread).
if (!self.MediaStreamTrackProcessor && isFirefox) {
  self.MediaStreamTrackProcessor = class MediaStreamTrackProcessor {
    static polyfill = true;
    constructor({ track }) {
      if (track.kind == "video") {
        this.readable = new ReadableStream({
          async start(controller) {
            this.video = document.createElement("video");
            this.video.srcObject = new MediaStream([track]);
            await Promise.all([
              this.video.play(),
              new Promise((r) => (this.video.onloadedmetadata = r)),
            ]);
            this.track = track;
            this.canvas = new OffscreenCanvas(
              this.video.videoWidth,
              this.video.videoHeight
            );
            this.ctx = this.canvas.getContext("2d", { desynchronized: true });
            this.t1 = performance.now();
          },
          async pull(controller) {
            while (
              performance.now() - this.t1 <
              1000 / track.getSettings().frameRate
            ) {
              await new Promise((r) => requestAnimationFrame(r));
            }
            this.t1 = performance.now();
            this.ctx.drawImage(this.video, 0, 0);
            controller.enqueue(
              new VideoFrame(this.canvas, { timestamp: this.t1 })
            );
          },
        });
      } else {
        throw new Error("Unsupported track kind: " + track.kind);
      }
    }
  };
}
