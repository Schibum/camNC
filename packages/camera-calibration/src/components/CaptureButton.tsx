import { useEffect } from "react";
import { useCalibrationStore } from "../store/calibrationStore";

interface CaptureButtonProps {
  disabled?: boolean;
}

export const CaptureButton: React.FC<CaptureButtonProps> = ({
  disabled = false,
}) => {
  const captureFrame = useCalibrationStore((state) => state.captureFrame);

  // Handle spacebar key press
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === "Space" && !disabled) {
        e.preventDefault();
        captureFrame(true);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [disabled]);

  return (
    <button
      className="capture-button group absolute bottom-[30px] left-1/2 -translate-x-1/2 w-[70px] h-[70px] rounded-full bg-white/30 cursor-pointer z-10 flex items-center justify-center transition-colors duration-200 hover:bg-white/40 disabled:opacity-50 disabled:cursor-not-allowed"
      onClick={() => captureFrame(true)}
      disabled={disabled}
      aria-label="Capture frame (Space)"
    >
      <div className="capture-button-inner w-[60px] h-[60px] rounded-full bg-[#ff4d4f] transition-transform duration-200 group-hover:scale-95 group-active:scale-90" />
    </button>
  );
};
