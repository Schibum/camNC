import { useCalibrationStore } from "../store/calibrationStore";
import { ChessboardOverlay } from "./ChessboardOverlay";
import { GridHeatmapOverlay } from "./CoverageHeatmap";
import { ManagedVideoElementView } from "./ManagedVideoElementView";
import { StatusOverlay } from "./StatusOverlay";

interface CameraViewProps {
  fullscreen?: boolean;
}

export const CameraView: React.FC<CameraViewProps> = ({
  fullscreen = false,
}) => {
  const { frameWidth, frameHeight, currentCorners, patternSize } =
    useCalibrationStore();

  // Video processing is now handled directly by the store via stream-based worker

  return (
    <div
      className={`video-container relative w-full h-full bg-black ${
        fullscreen ? "fixed top-0 left-0 right-0 bottom-0 z-[1000]" : ""
      }`}
    >
      <ManagedVideoElementView />
      <GridHeatmapOverlay />
      <ChessboardOverlay
        corners={currentCorners}
        patternSize={patternSize}
        frameWidth={frameWidth}
        frameHeight={frameHeight}
      />
      {/* <HeatmapArrowOverlay /> */}
      <StatusOverlay />
    </div>
  );
};
