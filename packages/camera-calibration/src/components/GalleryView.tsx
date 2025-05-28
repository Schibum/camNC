import {
  animated,
  config as springConfig,
  useTransition,
} from "@react-spring/web"; // Import config and SpringValue
import { CalibrationResult } from "@wbcnc/camera-calibration";
import { Button } from "@wbcnc/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@wbcnc/ui/components/dialog"; // Added Dialog imports
import { Trash } from "lucide-react";
import type { CSSProperties } from "react"; // Import CSSProperties for style typing
import { useCallback, useEffect, useRef, useState } from "react";
import { CapturedFrame } from "../lib/calibrationTypes";
import { useCalibrationStore } from "../store/calibrationStore";
import { CalibrationResultDisplay } from "./CalibrationResultDisplay"; // Import the new component
import { FrameDetailView } from "./FrameDetailView";
import { ImageWithCornersOverlay } from "./ImageWithCornersOverlay";
import { SaveFramesButton } from "./SaveFramesButton"; // Import the new button component

interface GalleryViewProps {
  onClose: () => void;
  isOpen: boolean; // Add isOpen prop
  onCalibrationConfirmed?: (result: CalibrationResult) => void;
}

interface GalleryItemProps {
  frame: CapturedFrame; // Use CapturedFrame type
  onSelect: (id: string) => void;
  onDelete: (id: string, e: React.MouseEvent) => void;
}

const GalleryItem: React.FC<GalleryItemProps> = ({
  frame,
  onSelect,
  onDelete,
}) => {
  const calibrationRms = useCalibrationStore((s) => s.calibrationResult?.rms);
  const isFrameErrHigh =
    calibrationRms &&
    frame.perViewError &&
    frame.perViewError > calibrationRms * 1.5;
  return (
    <div
      key={frame.id}
      className={`gallery-item group relative cursor-pointer transition-transform duration-200 ease-in-out hover:scale-[1.03] ${
        isFrameErrHigh ? "border-2 border-red-500 rounded-lg" : ""
      }`}
      onClick={() => onSelect(frame.id)}
    >
      <div className="aspect-[4/3] w-full rounded-lg overflow-hidden">
        <ImageWithCornersOverlay
          imageBlob={frame.imageBlob}
          corners={frame.corners}
          className="w-full h-full object-cover"
          cornerSize={6}
        />
      </div>
      <div className="gallery-item-overlay absolute inset-0 bg-black/50 flex justify-end items-start p-2 opacity-0 transition-opacity duration-200 ease-in-out group-hover:opacity-100 rounded-lg">
        <Button
          variant="ghost"
          onClick={(e) => onDelete(frame.id, e)}
          aria-label="Delete frame"
        >
          <Trash />
        </Button>
      </div>
      <div className="gallery-item-info absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent text-white text-xs px-2 pb-1 pt-3 text-right rounded-b-lg flex justify-between">
        <div>{new Date(frame.timestamp).toLocaleTimeString()}</div>

        <div className={isFrameErrHigh ? "text-red-400" : "text-white"}>
          {frame.perViewError && "err: " + frame.perViewError.toFixed(2)}
        </div>
      </div>
    </div>
  );
};

const AnimatedDiv = animated("div");

function ConfirmCalibrationButton({
  onCalibrationConfirmed,
}: {
  onCalibrationConfirmed?: (result: CalibrationResult) => void;
}) {
  const calibrationResult = useCalibrationStore((s) => s.calibrationResult);
  if (!calibrationResult || !onCalibrationConfirmed) return null;
  return (
    <Button onClick={() => onCalibrationConfirmed(calibrationResult)}>
      Use this calibration
    </Button>
  );
}

export const GalleryView: React.FC<GalleryViewProps> = ({
  onClose,
  isOpen,
  onCalibrationConfirmed,
}) => {
  const capturedFrames = useCalibrationStore((s) => s.capturedFrames);
  const deleteFrame = useCalibrationStore((s) => s.deleteFrame);
  const runCalibration = useCalibrationStore((s) => s.runCalibration);
  const isCalibrating = useCalibrationStore((s) => s.isCalibrating);
  const calibrationResult = useCalibrationStore((s) => s.calibrationResult);

  const [selectedFrameId, setSelectedFrameId] = useState<string | null>(null);
  const prevSelectedIdRef = useRef<string | null>(null);
  const directionRef = useRef(0); // Ref to store direction for leave animation

  useEffect(() => {
    prevSelectedIdRef.current = selectedFrameId;
  }, [selectedFrameId]);

  const selectedIndex = capturedFrames.findIndex(
    (f) => f.id === selectedFrameId
  );
  const prevSelectedIndex = capturedFrames.findIndex(
    (f) => f.id === prevSelectedIdRef.current
  );

  // Calculate direction: 1 for next, -1 for prev, 0 for initial/close
  const calculateDirection = () => {
    if (selectedIndex === -1 || prevSelectedIndex === -1) return 0; // Initial open or close
    if (selectedIndex === 0 && prevSelectedIndex === capturedFrames.length - 1)
      return 1; // Wrap around next
    if (selectedIndex === capturedFrames.length - 1 && prevSelectedIndex === 0)
      return -1; // Wrap around prev
    return selectedIndex > prevSelectedIndex ? 1 : -1;
  };

  const direction = calculateDirection();
  directionRef.current = direction; // Store current direction

  const handleFrameSelect = (id: string) => {
    setSelectedFrameId(id);
  };

  const handleNavigate = useCallback(
    (navDirection: "next" | "prev") => {
      if (selectedIndex === -1 || capturedFrames.length === 0) return;
      let nextIndex;
      if (navDirection === "next") {
        nextIndex = (selectedIndex + 1) % capturedFrames.length;
      } else {
        nextIndex =
          (selectedIndex - 1 + capturedFrames.length) % capturedFrames.length;
      }
      setSelectedFrameId(capturedFrames[nextIndex]!.id);
    },
    [capturedFrames, selectedIndex]
  );

  const handleFrameDelete = (id: string, e?: React.MouseEvent) => {
    // Make event optional
    e?.stopPropagation(); // Check if event exists before stopping propagation
    // If deleting the selected frame, close the detail view
    if (id === selectedFrameId) {
      setSelectedFrameId(null);
    }
    deleteFrame(id);
  };

  const handleDetailClose = () => {
    setSelectedFrameId(null);
  };

  // New handler specifically for the detail view's delete button
  const handleDetailDelete = (frameId: string) => {
    deleteFrame(frameId);
    handleDetailClose(); // Close the detail view after deleting
  };

  // Get the frame object based on ID
  const getFrameById = (id: string | null): CapturedFrame | null => {
    return capturedFrames.find((f) => f.id === id) || null;
  };

  // Define transitions
  const transitions = useTransition(getFrameById(selectedFrameId), {
    from: (item) => {
      const dir = directionRef.current; // Use direction from ref
      return {
        opacity: 0,
        transform: item
          ? `translateX(${dir === 0 ? 0 : dir * 100}%)`
          : "translateX(0%)",
        position: "absolute" as const, // Use 'as const' for type safety
      };
    },
    enter: {
      opacity: 1,
      transform: "translateX(0%)",
    },
    leave: () => {
      const dir = directionRef.current; // Use direction from ref
      return {
        opacity: 0,
        transform: `translateX(${dir === 0 ? 0 : dir * -100}%)`,
        position: "absolute" as const,
      };
    },
    config: springConfig.default,
    keys: (item) => item?.id ?? "null", // Provide a key, handle null case
  });

  return (
    <div className="gallery-view absolute inset-0 bg-black/95 z-20 p-5 overflow-y-auto text-white flex flex-col">
      <Dialog open={isOpen} onOpenChange={onClose}>
        <DialogContent className="w-screen h-screen max-w-none max-h-none sm:max-w-none sm:max-h-none rounded-none border-none p-0 flex flex-col bg-black/95 dark text-white">
          <div className="relative flex flex-col flex-grow overflow-hidden text-white">
            {!selectedFrameId && (
              <>
                <DialogHeader className="p-5 mb-5 flex-shrink-0 mr-10">
                  <div className="flex justify-between items-center flex-wrap gap-2">
                    <DialogTitle className="text-xl font-semibold">
                      Captured Frames
                    </DialogTitle>
                    <div className="flex gap-4 flex-wrap">
                      <SaveFramesButton />
                      <Button
                        onClick={runCalibration}
                        variant={calibrationResult ? "secondary" : "default"}
                        disabled={
                          capturedFrames.filter((f) => f.imageBlob).length <
                            3 || isCalibrating
                        }
                      >
                        {isCalibrating ? "Calibrating..." : "Calibrate"}
                      </Button>
                      <ConfirmCalibrationButton
                        onCalibrationConfirmed={onCalibrationConfirmed}
                      />
                    </div>
                  </div>
                </DialogHeader>

                <div className="px-5 flex-grow overflow-y-auto">
                  {calibrationResult && <CalibrationResultDisplay />}

                  {capturedFrames.length < 10 && (
                    <div className="text-yellow-400 text-sm m-1">
                      Please capture at least 10 frames for accurate
                      calibration.
                    </div>
                  )}

                  <div className="gallery-grid grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-4 overflow-y-auto">
                    {capturedFrames.map((frame) => (
                      <GalleryItem
                        key={frame.id}
                        frame={frame}
                        onSelect={handleFrameSelect}
                        onDelete={handleFrameDelete}
                      />
                    ))}
                    {capturedFrames.length === 0 && (
                      <div className="empty-gallery text-center mt-10 italic text-gray-400 col-span-full">
                        No frames captured yet.
                      </div>
                    )}
                  </div>
                </div>
              </>
            )}

            {transitions((style: CSSProperties, item: CapturedFrame | null) => {
              return item ? (
                <AnimatedDiv
                  style={{
                    ...style,
                    position: "absolute",
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    zIndex: 30,
                    backgroundColor: "hsl(var(--background))",
                  }}
                >
                  <FrameDetailView
                    frame={item}
                    onClose={handleDetailClose}
                    onNavigate={handleNavigate}
                    onDelete={handleDetailDelete}
                  />
                </AnimatedDiv>
              ) : null;
            })}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};
