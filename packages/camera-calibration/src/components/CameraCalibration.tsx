import { useEffect } from "react";
import { CalibrationResult, PatternSize } from "../lib/calibrationTypes";
import { Resolution, useCalibrationStore } from "../store/calibrationStore";
import { CameraView } from "./CameraView";
import { CaptureButton } from "./CaptureButton";
import { GalleryView } from "./GalleryView";
import { InstructionOverlay } from "./InstructionOverlay";
import { RecentCapturePreview } from "./RecentCapturePreview";

interface CameraCalibrationProps {
  src?: MediaStream | string;
  resolution?: Resolution;
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
  resolution,
  onCalibrationConfirmed,
  autoCapture = true,
  patternSize,
  squareSize,
  stabilityThreshold,
  similarityThreshold,
}) => {
  // Select actions (references are generally stable)
  const initializeSettings = useCalibrationStore(
    (state) => state.initializeSettings
  );
  const startCamera = useCalibrationStore((state) => state.startCamera);
  const stopCamera = useCalibrationStore((state) => state.stopCamera);
  const setShowGallery = useCalibrationStore((state) => state.setShowGallery);

  // Select state primitives individually
  const isStreaming = useCalibrationStore((state) => state.isStreaming);
  const frameWidth = useCalibrationStore((state) => state.frameWidth);
  const frameHeight = useCalibrationStore((state) => state.frameHeight);
  const showGallery = useCalibrationStore((state) => state.showGallery);

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
        await startCamera(src, resolution);
      } catch (storeError) {
        console.error(
          "[CameraCalibration] Store failed to start camera with provided src:",
          storeError
        );
      }
    };

    setupCamera();

    return () => {
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
