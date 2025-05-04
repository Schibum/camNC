import React from "react";
import { useShallow } from "zustand/react/shallow";
import { useCalibrationStore } from "../store/calibrationStore";

/**
 * Custom hook to select calibration processing metrics from the store.
 * Provides stability, uniqueness, FPS, and related state.
 */
export function useCalibrationMetrics() {
  // Select multiple values. Without useShallow, the component using this hook
  // will re-render if any of these selected values change.
  const metrics = useCalibrationStore(
    useShallow((state) => ({
      stabilityPercentage: state.stabilityPercentage,
      uniquenessPercentage: state.uniquenessPercentage,
      detectionFps: state.detectionFps,
      currentStableDuration: state.currentStableDuration,
      stabilityDurationThreshold: state.stabilityDurationThreshold,
      similarityThreshold: state.similarityThreshold,
    }))
  );

  return metrics;
}

export const StatusOverlay: React.FC = () => {
  const {
    stabilityPercentage,
    uniquenessPercentage,
    stabilityDurationThreshold,
    similarityThreshold,
    currentStableDuration,
    detectionFps,
  } = useCalibrationMetrics();

  const isStableForCapture =
    currentStableDuration >= stabilityDurationThreshold;
  const isUniqueEnough = uniquenessPercentage >= similarityThreshold;

  const stabilityColor = isStableForCapture
    ? "text-[#5cff5c]"
    : stabilityPercentage > 50
      ? "text-[#ffb347]"
      : "text-[#ffb347]";
  const uniquenessColor = isUniqueEnough ? "text-[#5cff5c]" : "text-[#ffb347]";

  return (
    <div className="absolute top-[20px] right-[20px] bg-black/70 text-white px-[15px] py-[10px] rounded-[8px] text-[14px] z-10">
      <div>
        Stability:{" "}
        <span className={`font-bold ml-[5px] ${stabilityColor}`}>
          {Math.round(stabilityPercentage)}%
        </span>
        {/* <span style={{ fontSize: '0.8em' }}> ({currentStableDuration}/{stabilityDurationThreshold})</span> */}
      </div>
      <div>
        Uniqueness:{" "}
        <span className={`font-bold ml-[5px] ${uniquenessColor}`}>
          {Math.round(uniquenessPercentage)}%
        </span>{" "}
        {/* <span style={{ fontSize: '0.8em' }}>(Threshold: {similarityThreshold}%)</span> */}
      </div>
      <div>
        Detection FPS:{" "}
        <span className="font-bold ml-[5px]">{detectionFps.toFixed(1)}</span>
      </div>
    </div>
  );
};
