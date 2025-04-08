import { useCalibrationStore } from '../store/calibrationStore';
import { useVideoProcessing } from '../hooks/useVideoProcessing';
import { StatusOverlay } from './StatusOverlay';
import { ManagedVideoElementView } from './ManagedVideoElementView';
import { ChessboardOverlay } from './ChessboardOverlay';

interface CameraViewProps {
  fullscreen?: boolean;
}

export const CameraView: React.FC<CameraViewProps> = ({ fullscreen = false }) => {
  const {
    frameWidth,
    frameHeight,
    currentCorners,
    patternSize,
  } = useCalibrationStore();

  // Hook to handle the OpenCV video processing loop
  useVideoProcessing();

  return (
    <div className={`video-container relative w-full h-full bg-black ${
      fullscreen ? 'fixed top-0 left-0 right-0 bottom-0 z-[1000]' : ''
    }`}>
      <ManagedVideoElementView />
      <ChessboardOverlay
        corners={currentCorners}
        patternSize={patternSize}
        frameWidth={frameWidth}
        frameHeight={frameHeight}
      />
      <StatusOverlay />
    </div>
  );
};