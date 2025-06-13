import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { useCalibrationStore } from '../store/calibrationStore';

export function RecentCapturePreview() {
  const { capturedFrames, setShowGallery } = useCalibrationStore();
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const prevFrameCount = useRef(capturedFrames.length);
  const isInitialMount = useRef(true);
  const [showShutter, setShowShutter] = useState(false);

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

  // Track if we should animate (when new frame is added after initial mount)
  const [shouldAnimate, setShouldAnimate] = useState(false);

  useEffect(() => {
    // Skip animation on initial mount
    if (isInitialMount.current) {
      isInitialMount.current = false;
      prevFrameCount.current = capturedFrames.length;
      return;
    }

    // Trigger animation and shutter effect when a new frame is added
    if (capturedFrames.length > prevFrameCount.current) {
      setShouldAnimate(true);
      setShowShutter(true);

      // Hide shutter after brief flash
      setTimeout(() => {
        setShowShutter(false);
      }, 150);
    }
    prevFrameCount.current = capturedFrames.length; // Update previous count
  }, [capturedFrames.length]);

  if (!mostRecentFrame || !imageUrl) {
    return (
      <>
        {/* Shutter effect */}
        <AnimatePresence>
          {showShutter && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="fixed inset-0 bg-white z-[9999] pointer-events-none"
            />
          )}
        </AnimatePresence>
      </>
    );
  }

  return (
    <>
      {/* Shutter effect */}
      <AnimatePresence>
        {showShutter && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 bg-white z-[9999] pointer-events-none"
          />
        )}
      </AnimatePresence>

      {/* Recent capture preview */}
      <motion.div
        key={mostRecentFrame.timestamp} // Re-trigger animation for new frames
        initial={
          shouldAnimate
            ? {
                opacity: 0,
                x: '40vw',
                y: '-40vh',
                scale: 0.1,
              }
            : {
                opacity: 1,
                x: 0,
                y: 0,
                scale: 1,
              }
        }
        animate={{
          opacity: 1,
          x: 0,
          y: 0,
          scale: 1,
        }}
        transition={{
          type: 'spring',
          tension: 220,
          friction: 20,
          bounce: 0,
        }}
        whileHover={{ scale: 1.05 }}
        className="recent-capture absolute bottom-[30px] left-[30px] w-[80px] h-[60px] rounded-[8px] overflow-hidden cursor-pointer shadow-lg z-10"
        onClick={() => setShowGallery(true)}>
        <img src={imageUrl} alt="Recent capture" className="recent-capture-image w-full h-full object-cover" />
        {capturedFrames.length > 0 && (
          <div className="recent-capture-count absolute top-[5px] right-[5px] bg-red-600 text-white text-[12px] w-[20px] h-[20px] rounded-full flex items-center justify-center">
            {capturedFrames.length}
          </div>
        )}
      </motion.div>
    </>
  );
}
