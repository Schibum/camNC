import React from "react";
import { useCalibrationStore } from "../store/calibrationStore";

export const StatusOverlay: React.FC = () => {
  const detectionFps = useCalibrationStore((state) => state.detectionFps);

  return (
    <div className="absolute top-[20px] right-[20px] bg-black/70 text-white px-[15px] py-[10px] rounded-[8px] text-[14px] z-10">
      <div>
        Detection FPS:{" "}
        <span className="font-bold ml-[5px]">{detectionFps.toFixed(1)}</span>
      </div>
    </div>
  );
};
