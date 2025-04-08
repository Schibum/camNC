import { useEffect, useRef, useState } from 'react';
import { useCalibrationStore } from '../store/calibrationStore';
import { useSpring, animated } from '@react-spring/web';

const AnimatedDiv = animated('div');

export const RecentCapturePreview: React.FC = () => {
  const { capturedFrames, setShowGallery } = useCalibrationStore();
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const prevFrameCount = useRef(capturedFrames.length);
  const isInitialMount = useRef(true);

  const mostRecentFrame = capturedFrames.length > 0 ? capturedFrames[capturedFrames.length - 1] : null;

  // Generate Object URL from Blob
  useEffect(() => {
    let currentUrl: string | null = null;
    if (mostRecentFrame?.imageBlob) {
      currentUrl = URL.createObjectURL(mostRecentFrame.imageBlob);
      setImageUrl(currentUrl);
    }

    // Cleanup Object URL when component unmounts or blob changes
    return () => {
      if (currentUrl) {
        URL.revokeObjectURL(currentUrl);
        setImageUrl(null); // Clear URL state
      }
    };
  }, [mostRecentFrame?.imageBlob]); // Depend only on the blob

  // Animation logic using react-spring for both entry and hover
  const [springs, api] = useSpring(() => ({
    from: { opacity: 1, transform: 'translate(0px, 0px) scale(1)' },
    config: { tension: 220, friction: 20 }, // Default config
  }));

  useEffect(() => {
    // Skip animation on initial mount
    if (isInitialMount.current) {
      isInitialMount.current = false;
      prevFrameCount.current = capturedFrames.length;
      // Set initial state without animation
      api.set({ opacity: 1, transform: 'translate(0px, 0px) scale(1)' });
      return;
    }

    // Animate only when a new frame is added
    if (capturedFrames.length > prevFrameCount.current) {
      api.start({
        from: { opacity: 0, transform: 'translate(40vw, -40vh) scale(0.1)' }, // Start from near center
        to: { opacity: 1, transform: 'translate(0px, 0px) scale(1)' },
        // Config specific to entry animation can be placed here if needed
      });
    }
    prevFrameCount.current = capturedFrames.length; // Update previous count
  }, [capturedFrames.length, api]);

  if (!mostRecentFrame || !imageUrl) {
    return null; // Don't render if no frame or image URL
  }

  // Hover handlers
  const handleMouseEnter = () => {
    api.start({ transform: 'translate(0px, 0px) scale(1.05)' });
  };

  const handleMouseLeave = () => {
    api.start({ transform: 'translate(0px, 0px) scale(1)' });
  };


  return (
    <AnimatedDiv
      style={springs} // Apply animation styles from react-spring
      className="recent-capture absolute bottom-[30px] left-[30px] w-[80px] h-[60px] rounded-[8px] overflow-hidden cursor-pointer shadow-lg z-10" // Removed CSS transition/hover classes
      onClick={() => setShowGallery(true)}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <img
        src={imageUrl}
        alt="Recent capture"
        className="recent-capture-image w-full h-full object-cover"
      />
      {capturedFrames.length > 0 && (
          <div className="recent-capture-count absolute top-[5px] right-[5px] bg-red-600 text-white text-[12px] w-[20px] h-[20px] rounded-full flex items-center justify-center">
            {capturedFrames.length}
          </div>
      )}
    </AnimatedDiv>
  );
};