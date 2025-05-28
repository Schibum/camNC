/**
 * Utility functions for handling video streams and conversion between different source types
 */

/**
 * Converts a video URL to a MediaStream by capturing from a video element
 * This is needed for worker-based processing which requires MediaStream
 */
export async function urlToMediaStream(
  url: string,
  resolution?: { width: number; height: number }
): Promise<MediaStream> {
  // Create a video element to capture the stream
  const video = document.createElement("video");
  video.src = url;
  video.crossOrigin = "anonymous";
  video.autoplay = true;
  video.muted = true;
  video.playsInline = true;

  // Wait for the video to load and start playing
  await new Promise<void>((resolve, reject) => {
    video.addEventListener(
      "loadedmetadata",
      () => {
        video.play().then(resolve).catch(reject);
      },
      { once: true }
    );
    video.addEventListener("error", reject, { once: true });
  });

  // Create a canvas to capture frames
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Failed to get 2D context from canvas");
  }

  // Set canvas dimensions
  if (resolution) {
    canvas.width = resolution.width;
    canvas.height = resolution.height;
  } else {
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
  }

  // Capture the stream from canvas
  const stream = canvas.captureStream(30); // 30 FPS

  // Draw video frames to canvas continuously
  function drawFrame() {
    if (!video.paused && !video.ended && ctx) {
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      requestAnimationFrame(drawFrame);
    }
  }
  drawFrame();

  return stream;
}

/**
 * Creates a ReadableStream<VideoFrame> from either a MediaStream or URL
 * This abstracts the creation of video processors for worker consumption
 */
export async function createVideoStreamProcessor(
  source: MediaStream | string
): Promise<ReadableStream<VideoFrame>> {
  let mediaStream: MediaStream;

  if (typeof source === "string") {
    // Convert URL to MediaStream
    mediaStream = await urlToMediaStream(source);
  } else {
    mediaStream = source;
  }

  const videoTrack = mediaStream.getVideoTracks()[0];
  if (!videoTrack) {
    throw new Error("No video track found in MediaStream");
  }

  // Use MediaStreamTrackProcessor to create a readable stream
  const processor = new (window as any).MediaStreamTrackProcessor({
    track: videoTrack,
  });
  return processor.readable;
}

/**
 * Type guard to check if MediaStreamTrackProcessor is available
 */
export function isMediaStreamTrackProcessorSupported(): boolean {
  return typeof (window as any).MediaStreamTrackProcessor !== "undefined";
}
