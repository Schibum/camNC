/**
 * Utility functions for handling video streams and conversion between different source types
 */

import * as Comlink from "comlink";
import type { StreamCornerFinderWorkerAPI } from "../workers/streamCornerFinder.worker";
import "./media-stream-processor-polyfil";

/**
 * Converts a video URL to a MediaStream by capturing from a video element
 * This is needed for worker-based processing which requires MediaStream
 */
export async function urlToMediaStream(
  url: string,
  resolution?: { width: number; height: number },
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
      { once: true },
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
  const stream = canvas.captureStream();

  // Draw video frames to canvas continuously
  function drawFrame() {
    if (!video.paused && !video.ended && ctx) {
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      video.requestVideoFrameCallback(drawFrame);
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
  source: MediaStream | string,
): Promise<ReadableStream<VideoFrame> | MediaStreamTrack> {
  let mediaStream: MediaStream;
  if (typeof source === "string") {
    mediaStream = await urlToMediaStream(source);
  } else {
    mediaStream = source;
  }

  const videoTrack = mediaStream.getVideoTracks()[0];
  if (!videoTrack) {
    throw new Error("No video track found in MediaStream");
  }

  if (isMediaStreamTrackProcessorSupported()) {
    const processor = new (window as any).MediaStreamTrackProcessor({
      track: videoTrack,
    });
    return processor.readable;
  } else {
    return videoTrack.clone();
  }
}

/**
 * Watches a MediaStream for video-track changes and asks the worker to switch
 * to a new MediaStreamTrackProcessor when that happens. Returns a cleanup
 * function to remove all listeners.
 */
export function attachMediaStreamTrackReplacer(
  mediaStream: MediaStream,
  workerProxy: Comlink.Remote<StreamCornerFinderWorkerAPI>,
): () => void {
  if (!isMediaStreamTrackProcessorSupported()) {
    console.warn(
      "MediaStreamTrackProcessor not supported – cannot attach track replacer",
    );
    return () => {};
  }

  let currentTrack: MediaStreamTrack | null =
    mediaStream.getVideoTracks()[0] || null;

  function handleEnded() {
    // When the current track ends, try the newest available track
    const tracks = mediaStream.getVideoTracks();
    if (tracks.length > 0) {
      sendTrackToWorker(tracks[tracks.length - 1]!);
    }
  }

  async function sendTrackToWorker(track: MediaStreamTrack) {
    if (!track) return;
    if (track === currentTrack) return;
    currentTrack = track;
    try {
      let readable: ReadableStream<VideoFrame> | MediaStreamTrack;
      if (isMediaStreamTrackProcessorSupported()) {
        const processor = new (window as any).MediaStreamTrackProcessor({
          track,
        });
        readable = processor.readable as ReadableStream<VideoFrame>;
      } else {
        readable = track;
      }
      await workerProxy.replaceStream(
        Comlink.transfer(readable, [readable]) as any,
      );
      // Listen for 'ended' on the newly adopted track so we can switch again.
      track.addEventListener("ended", handleEnded, { once: true });
      console.log("[attachMediaStreamTrackReplacer] Sent new stream to worker");
    } catch (err) {
      console.error("Failed to send new track to worker", err);
    }
  }

  const handleAddTrack = (event: MediaStreamTrackEvent) => {
    if (event.track.kind !== "video") return;
    sendTrackToWorker(event.track);
  };

  mediaStream.addEventListener("addtrack", handleAddTrack);
  mediaStream.addEventListener("removetrack", handleAddTrack);

  // Attach 'ended' listener to current track
  if (currentTrack) {
    currentTrack.addEventListener("ended", handleEnded, { once: true });
  }

  // Cleanup function
  return () => {
    mediaStream.removeEventListener("addtrack", handleAddTrack);
    mediaStream.removeEventListener("removetrack", handleAddTrack);
    if (currentTrack) {
      currentTrack.removeEventListener("ended", handleEnded);
    }
  };
}

/**
 * Type guard to check if MediaStreamTrackProcessor is available
 */
export function isMediaStreamTrackProcessorSupported(): boolean {
  return typeof (window as any).MediaStreamTrackProcessor !== "undefined";
}
