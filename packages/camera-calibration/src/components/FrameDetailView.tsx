import { Button } from "@wbcnc/ui/components/button";
import { ArrowLeft } from "lucide-react";
import { useEffect } from "react";
import { CapturedFrame } from "../lib/calibrationTypes";
import { ImageWithCornersOverlay } from "./ImageWithCornersOverlay";

interface FrameDetailViewProps {
  frame: CapturedFrame;
  onClose: () => void;
  onNavigate: (direction: "next" | "prev") => void;
  onDelete: (frameId: string) => void;
}

export const FrameDetailView: React.FC<FrameDetailViewProps> = ({
  frame,
  onClose,
  onNavigate,
  onDelete,
}) => {
  // Add keyboard navigation effect
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "ArrowRight" || event.key === " ") {
        event.preventDefault();
        onNavigate("next");
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        onNavigate("prev");
      } else if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onNavigate, onClose]);

  const handleDelete = () => {
    onDelete(frame.id);
    onClose();
  };

  if (!frame) {
    return <div>Frame not found</div>;
  }

  return (
    <div className="absolute inset-0 bg-black/95 z-20 overflow-y-auto text-white p-5">
      <div className="flex items-center mb-5 gap-4">
        <Button
          variant="ghost"
          size="icon"
          onClick={onClose}
          title="Close Detail View"
        >
          <ArrowLeft />
        </Button>
        <h3 className="text-xl font-semibold flex-1">Frame Details</h3>
        <div className="flex items-center gap-4">
          <Button
            variant="destructive"
            onClick={handleDelete}
            title="Delete Frame"
          >
            Delete
          </Button>
        </div>
      </div>
      <div className="flex flex-col gap-4">
        <ImageWithCornersOverlay
          imageBlob={frame.imageBlob}
          corners={frame.corners}
          className="w-full h-auto max-h-[70vh] object-contain"
        />
      </div>
    </div>
  );
};
