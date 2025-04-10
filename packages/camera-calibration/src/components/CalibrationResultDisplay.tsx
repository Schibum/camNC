import React from 'react';
import { useCalibrationStore } from '../store/calibrationStore';

export const CalibrationResultDisplay: React.FC = () => {
  const calibrationResult = useCalibrationStore(state => state.calibrationResult);

  if (!calibrationResult) {
    return null;
  }

  return (
    <div className="calibration-results mb-5 p-4 bg-white/10 rounded-lg flex-shrink-0">
      <h3 className="text-lg font-semibold mb-2">Calibration Results</h3>
      <div className="mb-1">RMS Error: {calibrationResult.rms.toFixed(4)}</div>
      <details className="mt-2.5">
        <summary className="cursor-pointer font-bold">Camera Matrix</summary>
        <pre className="bg-black/30 p-2.5 rounded mt-1 overflow-x-auto font-mono text-sm">
          {JSON.stringify(calibrationResult.cameraMatrix, null, 2)}
        </pre>
      </details>
      <details className="mt-2.5">
        <summary className="cursor-pointer font-bold">New Camera Matrix (alpha 0.1)</summary>
        <pre className="bg-black/30 p-2.5 rounded mt-1 overflow-x-auto font-mono text-sm">
          {JSON.stringify(calibrationResult.newCameraMatrix, null, 2)}
        </pre>
      </details>
      <details className="mt-2.5">
        <summary className="cursor-pointer font-bold">Distortion Coefficients</summary>
        <pre className="bg-black/30 p-2.5 rounded mt-1 overflow-x-auto font-mono text-sm">
          {JSON.stringify(calibrationResult.distCoeffs, null, 2)}
        </pre>
      </details>
    </div>
  );
};