import React from "react";
import { useCalibrationStore } from "../store/calibrationStore";

export const CalibrationResultDisplay: React.FC = () => {
  const calibrationResult = useCalibrationStore(
    (state) => state.calibrationResult,
  );

  if (!calibrationResult) {
    return null;
  }

  const getRmsColor = (rms: number) => {
    if (rms >= 1) return "text-red-500";
    if (rms >= 0.5) return "text-yellow-500";
    return "text-green-500";
  };

  const rms = calibrationResult.rms;
  const rmsColor = getRmsColor(rms);

  return (
    <div className="calibration-results mb-5 p-4 bg-white/10 rounded-lg flex-shrink-0">
      <h3 className="text-lg font-semibold mb-2">Calibration Results</h3>
      <div className={`mb-1 ${rmsColor}`}>
        Reprojection Error (RMS): {rms.toFixed(4)}
      </div>
      {rms >= 1 && (
        <div className="text-red-500 text-sm mt-1">
          High reprojection error. Consider re-calibrating using 10-20
          high-quality images (remove blurry frames, ensure good variety).
        </div>
      )}
      <details className="mt-2.5">
        <summary className="cursor-pointer font-bold">Camera Matrix</summary>
        <pre className="bg-black/30 p-2.5 rounded mt-1 overflow-x-auto font-mono text-sm">
          {JSON.stringify(calibrationResult.cameraMatrix, null, 2)}
        </pre>
      </details>
      <details className="mt-2.5">
        <summary className="cursor-pointer font-bold">
          New Camera Matrix (alpha 0.3)
        </summary>
        <pre className="bg-black/30 p-2.5 rounded mt-1 overflow-x-auto font-mono text-sm">
          {JSON.stringify(calibrationResult.newCameraMatrix, null, 2)}
        </pre>
      </details>
      <details className="mt-2.5">
        <summary className="cursor-pointer font-bold">
          Distortion Coefficients
        </summary>
        <pre className="bg-black/30 p-2.5 rounded mt-1 overflow-x-auto font-mono text-sm">
          {JSON.stringify(calibrationResult.distCoeffs, null, 2)}
        </pre>
      </details>
    </div>
  );
};
