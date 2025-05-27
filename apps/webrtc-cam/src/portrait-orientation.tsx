import { Button } from "@wbcnc/ui/components/button";
import { Lock, RotateCcw } from "lucide-react";
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

function useOrientation() {
  const [orientation, setOrientation] = useState<string>("portrait");

  useEffect(() => {
    // Only run on mobile devices
    if (!isMobile) return;

    const updateOrientation = () => {
      if (screen?.orientation) {
        setOrientation(screen.orientation.type);
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

  return orientation;
}

function OrientationOverlay() {
  return (
    <div className="fixed inset-0 bg-black bg-opacity-90 flex items-center justify-center z-50">
      <div className="text-center text-white p-8 mx-auto">
        <div className="mb-6">
          <RotateCcw
            className="w-16 h-16 mx-auto mb-4 animate-spin"
            style={{ animationDuration: "3s" }}
          />
        </div>
        <h2 className="text-2xl font-bold mb-4">
          Please Rotate Your Device and Lock Rotation
        </h2>
        <p className="text-lg mb-6">
          Portrait orientation is required to maintain consistent camera stream
          resolution.
        </p>
        <PortraitLockButton />
      </div>
    </div>
  );
}

export function PortraitOrientation() {
  const orientation = useOrientation();

  // On desktop, render nothing
  if (!isMobile) {
    return null;
  }

  // On mobile, show overlay if orientation lock failed and device is in landscape
  const shouldShowOverlay = orientation.includes("landscape");

  return shouldShowOverlay ? <OrientationOverlay /> : null;
}

export function PortraitLockButton() {
  async function handleClick() {
    await document.documentElement.requestFullscreen();
    if (screen?.orientation?.lock) {
      screen.orientation.lock("portrait-primary");
    }
  }
  if (!isMobile || !screen.orientation?.lock) return null;
  return (
    <Button onClick={handleClick} className="text-xl px-12 py-6">
      <Lock className="w-8 h-8 mr-3" />
      Lock to Portrait
    </Button>
  );
}
