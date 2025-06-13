import { useEffect } from 'react';
import { CalibrationResult, PatternSize } from '../lib/calibrationTypes';
import { Resolution, useCalibrationStore } from '../store/calibrationStore';
import { CameraView } from './CameraView';
import { CaptureButton } from './CaptureButton';
import { GalleryView } from './GalleryView';
import { InstructionOverlay } from './InstructionOverlay';
import { RecentCapturePreview } from './RecentCapturePreview';

interface CameraCalibrationProps {
  src?: MediaStream | string;
  resolution?: Resolution;
  onCalibrationConfirmed?: (result: CalibrationResult) => void;
  autoCapture?: boolean;
  patternSize?: PatternSize;
  squareSize?: number;
  zeroTangentDist?: boolean;
}

// Simple Loading Component (or replace with your preferred spinner)
const LoadingIndicator = () => <div className="flex justify-center items-center h-full min-h-[200px] text-white">Loading Camera...</div>;

export const CameraCalibration: React.FC<CameraCalibrationProps> = ({
  src,
  resolution,
  onCalibrationConfirmed,
  autoCapture = true,
  patternSize,
  squareSize,
  zeroTangentDist = false,
}) => {
  'use no memo';
  // Select actions (references are generally stable)
  const initializeSettings = useCalibrationStore(state => state.initializeSettings);
  const startCamera = useCalibrationStore(state => state.startCamera);
  const stopCamera = useCalibrationStore(state => state.stopCamera);
  const pauseProcessing = useCalibrationStore(state => state.pauseProcessing);
  const resumeProcessing = useCalibrationStore(state => state.resumeProcessing);
  const setShowGallery = useCalibrationStore(state => state.setShowGallery);

  // Select state primitives individually
  const isStreaming = useCalibrationStore(state => state.isStreaming);
  const frameWidth = useCalibrationStore(state => state.frameWidth);
  const frameHeight = useCalibrationStore(state => state.frameHeight);
  const showGallery = useCalibrationStore(state => state.showGallery);

  const isFullyReady = isStreaming && frameWidth > 0 && frameHeight > 0;

  useEffect(() => {
    initializeSettings({
      patternSize,
      squareSize,
      autoCapture,
      zeroTangentDist,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const setupCamera = async () => {
      if (!src) {
        console.log('[CameraCalibration] No src provided. Ensuring cleanup.');
        stopCamera();
        return;
      }

      try {
        console.log('[CameraCalibration] Valid src provided. Calling store.startCamera.');
        await startCamera(src, resolution);
      } catch (storeError) {
        console.error('[CameraCalibration] Store failed to start camera with provided src:', storeError);
      }
    };

    setupCamera();

    return () => {
      console.log('[CameraCalibration] Cleanup: Calling store.stopCamera (element cleanup).');
      stopCamera();
    };
  }, [src, startCamera, stopCamera, resolution]);

  // Pause/resume processing based on gallery visibility
  useEffect(() => {
    if (showGallery) {
      pauseProcessing();
    } else {
      resumeProcessing();
    }
  }, [showGallery, pauseProcessing, resumeProcessing]);

  if (!window.cv) {
    throw new Error('OpenCV is not loaded');
  }

  return (
    <div className="camera-calibration relative w-full h-full overflow-hidden bg-black dark">
      {!showGallery ? (
        isFullyReady ? (
          <div className="camera-view-container relative w-full h-full flex items-center justify-center">
            <CameraView />
            <InstructionOverlay />

            <>
              <CaptureButton disabled={!isStreaming} />
              <RecentCapturePreview />
            </>
          </div>
        ) : (
          <LoadingIndicator />
        )
      ) : (
        <GalleryView onClose={() => setShowGallery(false)} onCalibrationConfirmed={onCalibrationConfirmed} isOpen={showGallery} />
      )}
    </div>
  );
};
