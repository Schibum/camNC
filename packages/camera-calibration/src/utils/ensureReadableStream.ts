// For FF
import "./media-stream-processor-polyfil";
/// <reference lib="webworker" />

/**
 * Converts a MediaStreamTrack to a ReadableStream<VideoFrame> if it is not already.
 * @param trackOrReadable - The MediaStreamTrack or ReadableStream<VideoFrame> to convert.
 * @returns A ReadableStream<VideoFrame>.
 */
export function ensureReadableStream(
  trackOrReadable: MediaStreamTrack | ReadableStream<VideoFrame>,
): ReadableStream<VideoFrame> {
  if (trackOrReadable instanceof ReadableStream) {
    return trackOrReadable;
  } else {
    const processor = new (self as any).MediaStreamTrackProcessor({
      track: trackOrReadable,
    });
    return processor.readable;
  }
}
