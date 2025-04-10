import React from 'react';
import { useCalibrationStore } from '../store/calibrationStore';

export const StatusOverlay: React.FC = () => {
  const {
    stabilityPercentage,
    uniquenessPercentage,
    stabilityDurationThreshold,
    similarityThreshold,
    currentStableDuration,
    detectionFps,
  } = useCalibrationStore();

  const isStableForCapture = currentStableDuration >= stabilityDurationThreshold;
  const isUniqueEnough = uniquenessPercentage >= similarityThreshold;

  const stabilityColor = isStableForCapture ? 'text-[#5cff5c]' : (stabilityPercentage > 50 ? 'text-[#ffb347]' : 'text-[#ffb347]');
  const uniquenessColor = isUniqueEnough ? 'text-[#5cff5c]' : 'text-[#ffb347]';

  return (
    <div className="absolute top-[20px] left-[20px] bg-black/70 text-white px-[15px] py-[10px] rounded-[8px] text-[14px] z-10">
      <div>
        Stability:{' '}
        <span className={`font-bold ml-[5px] ${stabilityColor}`}>
          {Math.round(stabilityPercentage)}%
        </span>
        {/* <span style={{ fontSize: '0.8em' }}> ({currentStableDuration}/{stabilityDurationThreshold})</span> */}
      </div>
      <div>
        Uniqueness:{' '}
        <span className={`font-bold ml-[5px] ${uniquenessColor}`}>
          {Math.round(uniquenessPercentage)}%
        </span>
        {' '}
        {/* <span style={{ fontSize: '0.8em' }}>(Threshold: {similarityThreshold}%)</span> */}
      </div>
      <div>
        Detection FPS:{' '}
        <span className="font-bold ml-[5px]">
          {detectionFps.toFixed(1)}
        </span>
      </div>
    </div>
  );
};