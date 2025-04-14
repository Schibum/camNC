import React, { useEffect, useState } from "react";
import { useCalibrationStore } from "../store/calibrationStore";

interface InstructionOverlayProps {
  // Pass the similarity threshold configured in the parent
  similarityThreshold?: number;
}

// Styling for the message (can be moved to CSS)
// const instructionStyle: React.CSSProperties = {
//     position: 'absolute',
//     bottom: '120px', // Adjust as needed
//     left: '50%',
//     transform: 'translateX(-50%)',
//     backgroundColor: 'rgba(0, 0, 0, 0.6)',
//     color: 'white',
//     padding: '5px 15px',
//     borderRadius: '15px',
//     fontSize: '1.5em',
//     textAlign: 'center',
//     zIndex: 10,
// };

export const InstructionOverlay: React.FC<InstructionOverlayProps> = ({
  similarityThreshold,
}) => {
  // Local state for the message - changed type to React.ReactNode
  const [message, setMessage] = useState<React.ReactNode>(null);

  // Get relevant state from the store
  const {
    isAutoCaptureEnabled,
    isStreaming,
    frameWidth,
    frameHeight,
    currentCorners,
    patternSize,
    stabilityPercentage,
    uniquenessPercentage,
  } = useCalibrationStore();

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

    // Check if corners are detected
    if (!currentCorners) {
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
    }

    // --- If corners ARE detected, check uniqueness/stability ---
    // Use threshold from props or default
    const simThresh =
      typeof similarityThreshold === "number" ? similarityThreshold : 15;
    // Stability threshold for message
    const stabThreshPercent = 90;

    if (uniquenessPercentage < simThresh) {
      setMessage("Move chessboard to new location");
    } else if (stabilityPercentage < stabThreshPercent) {
      setMessage("Hold still");
    } else {
      setMessage(null); // Clear message if ready for capture
    }
  }, [
    isAutoCaptureEnabled,
    isFullyReady,
    currentCorners,
    patternSize,
    uniquenessPercentage,
    stabilityPercentage,
    similarityThreshold, // Use prop value in dependency array
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
};
