import { useEffect } from "react";
import { CalibrationResult, PatternSize } from "../lib/calibrationTypes";
import { useCalibrationStore } from "../store/calibrationStore";
import { CameraView } from "./CameraView";
import { CaptureButton } from "./CaptureButton";
import { GalleryView } from "./GalleryView";
import { InstructionOverlay } from "./InstructionOverlay";
import { RecentCapturePreview } from "./RecentCapturePreview";

interface CameraCalibrationProps {
  src?: MediaStream | string;
  onCalibrationConfirmed?: (result: CalibrationResult) => void;
  autoCapture?: boolean;
  patternSize?: PatternSize;
  squareSize?: number;
  stabilityThreshold?: number;
  similarityThreshold?: number;
}

// Simple Loading Component (or replace with your preferred spinner)
const LoadingIndicator = () => (
  <div className="flex justify-center items-center h-full min-h-[200px] text-white">
    Loading Camera...
  </div>
);

export const CameraCalibration: React.FC<CameraCalibrationProps> = ({
  src,
  onCalibrationConfirmed,
  autoCapture = true,
  patternSize,
  squareSize,
  stabilityThreshold,
  similarityThreshold,
}) => {
  const {
    initializeSettings,
    startCamera,
    stopCamera,
    isStreaming,
    frameWidth,
    frameHeight,
    showGallery,
    setShowGallery,
  } = useCalibrationStore();

  const isFullyReady = isStreaming && frameWidth > 0 && frameHeight > 0;

  useEffect(() => {
    initializeSettings({
      patternSize,
      squareSize,
      stabilityDurationThreshold: stabilityThreshold,
      similarityThreshold,
      autoCapture,
    });
  }, [
    initializeSettings,
    patternSize,
    squareSize,
    stabilityThreshold,
    similarityThreshold,
    autoCapture,
  ]);

  useEffect(() => {
    let isMounted = true;

    const setupCamera = async () => {
      if (!src) {
        console.log("[CameraCalibration] No src provided. Ensuring cleanup.");
        stopCamera();
        return;
      }

      try {
        console.log(
          "[CameraCalibration] Valid src provided. Calling store.startCamera."
        );
        await startCamera(src);
        if (isMounted) {
          console.log("[CameraCalibration] Store finished startCamera.");
        }
      } catch (storeError) {
        console.error(
          "[CameraCalibration] Store failed to start camera with provided src:",
          storeError
        );
      }
    };

    setupCamera();

    return () => {
      isMounted = false;
      console.log(
        "[CameraCalibration] Cleanup: Calling store.stopCamera (element cleanup)."
      );
      stopCamera();
    };
  }, [src, startCamera, stopCamera]);

  if (!window.cv) {
    throw new Error("OpenCV is not loaded");
  }

  return (
    <div className="camera-calibration relative w-full h-full overflow-hidden bg-black dark">
      {!showGallery ? (
        isFullyReady ? (
          <div className="camera-view-container relative w-full h-full flex items-center justify-center">
            <CameraView />

            <InstructionOverlay similarityThreshold={similarityThreshold} />

            <>
              <CaptureButton disabled={!isStreaming} />
              <RecentCapturePreview />
            </>
          </div>
        ) : (
          <LoadingIndicator />
        )
      ) : (
        <GalleryView
          onClose={() => setShowGallery(false)}
          onCalibrationConfirmed={onCalibrationConfirmed}
          isOpen={showGallery}
        />
      )}
    </div>
  );
};
