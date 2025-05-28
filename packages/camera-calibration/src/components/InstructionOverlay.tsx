import React, { useEffect, useState } from "react";
import { useCalibrationStore } from "../store/calibrationStore";

export function InstructionOverlay() {
  // Local state for the message - changed type to React.ReactNode
  const [message, setMessage] = useState<React.ReactNode>(null);

  // Select needed state individually
  const isAutoCaptureEnabled = useCalibrationStore(
    (state) => state.isAutoCaptureEnabled
  );
  const isStreaming = useCalibrationStore((state) => state.isStreaming);
  const frameWidth = useCalibrationStore((state) => state.frameWidth);
  const frameHeight = useCalibrationStore((state) => state.frameHeight);
  const currentCorners = useCalibrationStore((state) => state.currentCorners);
  const patternSize = useCalibrationStore((state) => state.patternSize);
  const rejectedReason = useCalibrationStore((state) => state.rejectedReason);

  // Determine overall readiness (same logic as in CameraCalibration)
  const isFullyReady = isStreaming && frameWidth > 0 && frameHeight > 0;

  useEffect(() => {
    // Basic checks: auto-capture enabled and system ready
    if (!isAutoCaptureEnabled || !isFullyReady) {
      setMessage(null);
      return;
    }

    // Check for pattern size validity
    if (!patternSize) {
      return;
    }

    if (rejectedReason === "blurry") {
      setMessage(<>😕 Chessboard is blurry, hold still</>);
    } else if (!currentCorners) {
      // Construct the message with the link around the dimensions
      setMessage(
        <>
          Show{" "}
          <a
            href="https://chessboard-camera-calibration.vercel.app/"
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-400 underline"
          >
            {`${patternSize.width}x${patternSize.height} chessboard`}
          </a>{" "}
          to camera
        </>
      );
      return;
    } else if (rejectedReason === "not_unique") {
      setMessage(<>↗️ Move or 🔄 rotate chessboard</>);
    } else {
      setMessage(null); // Clear message if ready for capture
    }
  }, [
    isAutoCaptureEnabled,
    isFullyReady,
    currentCorners,
    patternSize,
    rejectedReason,
  ]);

  // Render the message div only if a message exists
  if (!message) {
    return null;
  }

  return (
    <div className="absolute bottom-[120px] left-1/2 -translate-x-1/2 bg-black/60 text-white px-[15px] py-[5px] rounded-[15px] text-[1.5em] text-center z-10">
      {message}
    </div>
  );
}
