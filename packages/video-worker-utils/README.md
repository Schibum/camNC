# Video Worker Utils

Helpers for processing video in web workers:

- `createVideoStreamProcessor` – turn a `MediaStream` or URL into a transferable
  `ReadableStream<VideoFrame>` (with a polyfill for browsers without
  `MediaStreamTrackProcessor`).
- `attachMediaStreamTrackReplacer` – hand a new stream to a worker when the
  source's video track changes.
- `registerThreeJsTransferHandlers` – Comlink transfer handler for three.js
  `Matrix3`/`Vector3` values.

Used by camNC (marker scanner, depth pipeline) and camera-calibration.
