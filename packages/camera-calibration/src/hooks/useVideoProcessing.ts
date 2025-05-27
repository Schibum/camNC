import { useEffect, useRef } from "react";
import { useCalibrationStore } from "../store/calibrationStore";
import { CornerFinderWorkerManager } from "../utils/workerManager";

// Smoothing factor moved to store
// const FPS_SMOOTHING_FACTOR = 0.1;

// TODO: this does not need to be on the main thread at all, we can offload it
// to a worker completely (see markerScanner.worker.ts)

export function useVideoProcessing() {
  const animationFrameId = useRef<number | null>(null);
  const workerManagerRef = useRef<CornerFinderWorkerManager | null>(null);
  const captureCanvasCtxRef = useRef<CanvasRenderingContext2D | null>(null);
  // Smoothed FPS state moved to store
  // const smoothedFpsRef = useRef<number>(0);

  // Initialize worker manager once
  useEffect(() => {
    if (!workerManagerRef.current) {
      workerManagerRef.current = new CornerFinderWorkerManager();
      workerManagerRef.current.init();
    }

    return () => {
      if (workerManagerRef.current) {
        workerManagerRef.current.terminate();
        workerManagerRef.current = null;
      }
    };
  }, []); // Empty dependency array since we only want to initialize once

  useEffect(() => {
    const cv = window.cv;
    const store = useCalibrationStore.getState();

    if (!store.isStreaming || !store.videoElement || !cv) {
      // Stop processing if core prerequisites aren't met
      if (animationFrameId.current) {
        cancelAnimationFrame(animationFrameId.current);
        animationFrameId.current = null;
      }
      return;
    }

    // --- Initialization & Processing Loop ---
    // Initialize resources
    if (!captureCanvasCtxRef.current) {
      console.log("[useVideoProcessing] Initializing VideoCapture.");
      const canvas = document.createElement("canvas");
      canvas.width = store.frameWidth;
      canvas.height = store.frameHeight;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) throw new Error("Failed to create canvas context.");
      captureCanvasCtxRef.current = ctx;
    }

    if (!captureCanvasCtxRef.current || !workerManagerRef.current) {
      console.error(
        "[useVideoProcessing] Core resources not initialized correctly."
      );
      return;
    }

    const processFrame = async () => {
      const {
        isStreaming,
        videoElement,
        frameWidth,
        frameHeight,
        patternSize,
        updateCorners,
        clearCorners,
      } = useCalibrationStore.getState();
      const captureCtx = captureCanvasCtxRef.current;

      if (
        !isStreaming ||
        !videoElement ||
        !captureCtx ||
        !workerManagerRef.current
      ) {
        animationFrameId.current = null;
        return;
      }

      try {
        if (videoElement.readyState < videoElement.HAVE_CURRENT_DATA) {
          console.log(
            "[useVideoProcessing] Waiting for detached video data..."
          );
          // Don't schedule next frame here, wait for data
          animationFrameId.current = requestAnimationFrame(processFrame);
          return;
        }

        if (workerManagerRef.current.isBusy()) {
          // console.log('[useVideoProcessing] Worker is busy, skipping frame...'); // Reduce noise
          animationFrameId.current = requestAnimationFrame(processFrame);
          return;
        }

        captureCtx.drawImage(videoElement, 0, 0, frameWidth, frameHeight);
        const imgData = captureCtx.getImageData(0, 0, frameWidth, frameHeight);

        // Send frame to worker for processing
        const result = await workerManagerRef.current.processFrame(
          imgData,
          patternSize.width,
          patternSize.height
        );
        const cornerData = result.corners;
        if (cornerData) {
          // only needed if detected. Alternative would be always copying to worker.
          const imgDataCpy = captureCtx.getImageData(
            0,
            0,
            frameWidth,
            frameHeight
          );
          updateCorners(cornerData, imgDataCpy, result.isUnique);
        } else {
          clearCorners(result.isBlurry);
        }
      } catch (error: any) {
        console.error(
          "[useVideoProcessing] Error reading/posting frame:",
          error
        );
        clearCorners();
      } finally {
        // Schedule next frame only after current processing is done
        if (useCalibrationStore.getState().isStreaming) {
          // Check again in case it was stopped
          animationFrameId.current = requestAnimationFrame(processFrame);
        }
      }
    };

    if (!animationFrameId.current) {
      console.log("[useVideoProcessing] Starting processing loop.");
      animationFrameId.current = requestAnimationFrame(processFrame);
    }

    // Cleanup function
    return () => {
      console.log("[useVideoProcessing] Cleaning up hook...");
      if (animationFrameId.current) {
        cancelAnimationFrame(animationFrameId.current);
        animationFrameId.current = null;
      }
    };
  }, []); // Empty dependency array since we're accessing store values directly
}
