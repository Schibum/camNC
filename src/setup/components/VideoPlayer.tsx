import React, { useState, useEffect, useRef, ForwardedRef, forwardRef } from 'react';

interface VideoPlayerProps {
  url: string;
  onLoad?: (dimensions: { width: number; height: number }) => void;
  onError?: (error: string) => void;
  containerRef?: React.RefObject<HTMLDivElement>;
  style?: React.CSSProperties;
}

// Component to encapsulate video loading, error handling, and display
export const VideoPlayer = forwardRef((
  { url, onLoad, onError, style = {} }: VideoPlayerProps,
  ref: ForwardedRef<HTMLVideoElement>
) => {
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const actualRef = (ref as React.RefObject<HTMLVideoElement>) || videoRef;

  // Loading spinner style
  const spinnerStyle: React.CSSProperties = {
    position: 'absolute',
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
    zIndex: 10,
    color: 'white',
    textAlign: 'center'
  };

  // Error message style
  const errorStyle: React.CSSProperties = {
    position: 'absolute',
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
    zIndex: 10,
    color: 'white',
    textAlign: 'center',
    background: 'rgba(255, 0, 0, 0.7)',
    padding: '20px',
    borderRadius: '8px',
    maxWidth: '80%'
  };

  // Track video dimensions when loaded
  useEffect(() => {
    const handleVideoMetadata = () => {
      if (actualRef.current) {
        const { videoWidth, videoHeight } = actualRef.current;
        setIsLoading(false);

        if (onLoad) {
          onLoad({ width: videoWidth, height: videoHeight });
        }
      }
    };

    const handleVideoError = (e: Event) => {
      setIsLoading(false);
      const errorMessage = "Failed to load video. Please check the URL and try again.";
      setLoadError(errorMessage);

      if (onError) {
        onError(errorMessage);
      }

      console.error("Video loading error:", e);
    };

    const videoElement = actualRef.current;
    if (videoElement) {
      // Reset states when url changes
      setIsLoading(true);
      setLoadError(null);

      videoElement.addEventListener('loadedmetadata', handleVideoMetadata);
      videoElement.addEventListener('error', handleVideoError);

      // If video is already loaded, get dimensions immediately
      if (videoElement.videoWidth) {
        handleVideoMetadata();
      }

      return () => {
        videoElement.removeEventListener('loadedmetadata', handleVideoMetadata);
        videoElement.removeEventListener('error', handleVideoError);
      };
    }
  }, [url, onLoad, onError, actualRef]);

  // Function to retry loading the video
  const handleRetry = () => {
    if (actualRef.current) {
      setIsLoading(true);
      setLoadError(null);
      actualRef.current.load();
    }
  };

  // Final component styles
  const videoStyle: React.CSSProperties = {
    width: '100%',
    height: '100%',
    objectFit: 'contain',
    ...style
  };

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      {/* Loading spinner */}
      {isLoading && (
        <div style={spinnerStyle}>
          <div style={{
            width: '40px',
            height: '40px',
            margin: '0 auto',
            border: '4px solid rgba(255, 255, 255, 0.3)',
            borderRadius: '50%',
            borderTop: '4px solid white',
            animation: 'spin 1s linear infinite'
          }}></div>
          <p style={{ marginTop: '10px' }}>Loading video...</p>
          <style>
            {`@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }`}
          </style>
        </div>
      )}

      {/* Error message */}
      {loadError && (
        <div style={errorStyle}>
          <p>{loadError}</p>
          <button
            onClick={handleRetry}
            style={{
              marginTop: '10px',
              padding: '8px 16px',
              backgroundColor: 'white',
              color: 'black',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer'
            }}
          >
            Retry
          </button>
        </div>
      )}

      <video
        ref={actualRef}
        src={url}
        style={videoStyle}
        autoPlay
        muted
        playsInline
      />
    </div>
  );
});