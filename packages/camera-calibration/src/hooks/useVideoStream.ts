import { RefObject, useEffect } from "react";
import { useCalibrationStore } from "../store/calibrationStore";

/**
 * Custom hook to connect a MediaStream from the Zustand store to a video element.
 *
 * @param videoRef Ref object pointing to the target HTMLVideoElement.
 */
export function useVideoStream(videoRef: RefObject<HTMLVideoElement | null>) {
  // Subscribe to stream changes in the store
  const stream = useCalibrationStore((state) => state.stream);

  useEffect(() => {
    const videoElement = videoRef.current;

    if (videoElement && stream) {
      // If the element exists and the stream exists
      if (videoElement.srcObject !== stream) {
        console.log("[useVideoStream] Attaching stream to video element.");
        // Assign the stream from the store to the video element
        videoElement.srcObject = stream;
        // Attempt to play the video
        videoElement.play().catch((error) => {
          // Log potential errors (e.g., autoplay restrictions)
          console.warn(
            "[useVideoStream] Error attempting to play video:",
            error
          );
        });
      }
    } else if (videoElement && !stream) {
      // If the element exists but the stream is null (e.g., stopped)
      if (videoElement.srcObject) {
        console.log("[useVideoStream] Clearing srcObject as stream is null.");
        // Clear the srcObject if the stream is gone
        videoElement.srcObject = null;
      }
    }

    // No cleanup needed here for the stream itself, as its lifecycle
    // is managed externally (e.g., in CameraCalibration component or by the store actions).

    // Dependencies: Re-run the effect if the stream in the store changes,
    // or if the videoRef.current potentially points to a new element (though the ref object itself is stable).
    // Including videoRef in deps ensures effect runs if parent re-renders passing a different ref instance,
    // although in this specific case CameraCalibration uses useRef, which is stable.
  }, [stream, videoRef]);
}
