import { Button } from "@wbcnc/ui/components/button";
import { RotateCcw } from "lucide-react";
import { useEffect, useState } from "react";
import { isMobile } from "react-device-detect";

// TypeScript declarations for Screen Orientation API
declare global {
  interface ScreenOrientation {
    lock?(orientation: OrientationLockType): Promise<void>;
  }
}

type OrientationLockType =
  | "any"
  | "natural"
  | "landscape"
  | "portrait"
  | "portrait-primary"
  | "portrait-secondary"
  | "landscape-primary"
  | "landscape-secondary";

function useOrientationLock() {
  const [isLocked, setIsLocked] = useState(false);
  const [lockFailed, setLockFailed] = useState(false);
  const [orientation, setOrientation] = useState<string>("portrait");

  useEffect(() => {
    // Only run on mobile devices
    if (!isMobile) return;

    const updateOrientation = () => {
      if (screen?.orientation) {
        setOrientation(screen.orientation.type);
      } else if (window.orientation !== undefined) {
        // Fallback for older browsers
        const angle = Math.abs(window.orientation);
        setOrientation(angle === 0 || angle === 180 ? "portrait" : "landscape");
      }
    };

    const handleOrientationChange = () => {
      updateOrientation();
    };

    // Set initial orientation
    updateOrientation();

    // Listen for orientation changes
    if (screen?.orientation) {
      screen.orientation.addEventListener("change", handleOrientationChange);
    } else {
      window.addEventListener("orientationchange", handleOrientationChange);
    }

    // Try to lock orientation
    const lockOrientation = async () => {
      if (screen?.orientation?.lock) {
        try {
          await screen.orientation.lock("portrait-primary");
          setIsLocked(true);
          setLockFailed(false);
        } catch (error) {
          console.warn("Failed to lock orientation:", error);
          setLockFailed(true);
          setIsLocked(false);
        }
      } else {
        setLockFailed(true);
        setIsLocked(false);
      }
    };

    lockOrientation();

    return () => {
      if (screen?.orientation) {
        screen.orientation.removeEventListener(
          "change",
          handleOrientationChange
        );
      } else {
        window.removeEventListener(
          "orientationchange",
          handleOrientationChange
        );
      }
    };
  }, []);

  return { isLocked, lockFailed, orientation };
}

function OrientationOverlay({ onDismiss }: { onDismiss?: () => void }) {
  return (
    <div className="fixed inset-0 bg-black bg-opacity-90 flex items-center justify-center z-50">
      <div className="text-center text-white p-8 max-w-sm mx-auto">
        <div className="mb-6">
          <RotateCcw
            className="w-16 h-16 mx-auto mb-4 animate-spin"
            style={{ animationDuration: "3s" }}
          />
        </div>
        <h2 className="text-2xl font-bold mb-4">Please Rotate Your Device</h2>
        <p className="text-lg mb-6">
          Portrait orientation is required to maintain consistent camera stream
          resolution and prevent aspect ratio distortion.
        </p>
        {onDismiss && (
          <Button
            onClick={onDismiss}
            variant="outline"
            className="bg-white text-black"
          >
            Continue Anyway
          </Button>
        )}
      </div>
    </div>
  );
}

export function PortraitOrientation() {
  const { isLocked, lockFailed, orientation } = useOrientationLock();
  const [overlayDismissed, setOverlayDismissed] = useState(false);

  // On desktop, render nothing
  if (!isMobile) {
    return null;
  }

  // On mobile, show overlay if orientation lock failed and device is in landscape
  const shouldShowOverlay =
    lockFailed && !overlayDismissed && orientation.includes("landscape");

  return shouldShowOverlay ? (
    <OrientationOverlay onDismiss={() => setOverlayDismissed(true)} />
  ) : null;
}
