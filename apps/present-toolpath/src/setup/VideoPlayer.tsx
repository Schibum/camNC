import React, { useRef, forwardRef, useLayoutEffect, SyntheticEvent } from 'react';
import { atom, useAtom } from 'jotai';

interface VideoPlayerProps {
  url: string;
  onLoad?: (dimensions: { width: number; height: number }) => void;
  onError?: (error: string) => void;
  containerRef?: React.RefObject<HTMLDivElement>;
  style?: React.CSSProperties;
}

// Define atoms for video player state
// Jotai atoms are writable by default
const isLoadingAtom = atom(true);
const loadErrorAtom = atom<string | null>(null as string | null);
const isInitializedAtom = atom(false);

// Component to encapsulate video loading, error handling, and display
export const VideoPlayer = forwardRef(({ url, onLoad, onError, style = {} }: VideoPlayerProps) => {
  // Use atoms
  const [isLoading, setIsLoading] = useAtom(isLoadingAtom);
  const [loadError, setLoadError] = useAtom(loadErrorAtom);
  const [isInitialized, setIsInitialized] = useAtom(isInitializedAtom);

  // Refs don't cause re-renders when updated
  const videoRef = useRef<HTMLVideoElement>(null);
  const previousUrlRef = useRef<string>(url);
  const hasCalledOnLoadRef = useRef<boolean>(false);

  // Setup ref and initialization
  useLayoutEffect(() => {
    // Initialize on first render
    if (!isInitialized) {
      setIsInitialized(true);
    }
  }, []);

  // Handle URL changes
  useLayoutEffect(() => {
    if (previousUrlRef.current !== url) {
      previousUrlRef.current = url;
      setIsLoading(true);
      setLoadError(null);
      hasCalledOnLoadRef.current = false;
    }
  }, [url]);

  // Handle video events

  // Define stable event handlers using refs to avoid recreation
  const handleVideoMetadata = (videoElement: HTMLVideoElement) => {
    setIsLoading(false);

    // Call onLoad only once per URL change
    if (!hasCalledOnLoadRef.current && onLoad) {
      const { videoWidth, videoHeight } = videoElement;
      onLoad({ width: videoWidth, height: videoHeight });
      hasCalledOnLoadRef.current = true;
    }
  };

  const handleVideoError = (e: SyntheticEvent<HTMLVideoElement>) => {
    const errorMessage = 'Failed to load video. Please check the URL and try again.';
    setIsLoading(false);
    setLoadError(errorMessage);

    if (onError) {
      onError(errorMessage);
    }

    console.error('Video loading error:', e);
  };

  // Component styles
  const containerStyle = { position: 'relative', width: '100%', height: '100%' } as const;
  const videoStyle = { width: '100%', height: '100%', objectFit: 'contain', ...style } as const;
  const spinnerStyle = {
    position: 'absolute',
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
    zIndex: 10,
    color: 'white',
    textAlign: 'center',
  } as const;
  const errorStyle = {
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
    maxWidth: '80%',
  } as const;

  return (
    <div style={containerStyle}>
      {/* Loading spinner */}
      {isLoading && (
        <div style={spinnerStyle}>
          <div
            style={{
              width: '40px',
              height: '40px',
              margin: '0 auto',
              border: '4px solid rgba(255, 255, 255, 0.3)',
              borderRadius: '50%',
              borderTop: '4px solid white',
              animation: 'spin 1s linear infinite',
            }}
          ></div>
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
        </div>
      )}

      <video
        ref={videoRef}
        src={url}
        style={videoStyle}
        onLoadedMetadata={ev => handleVideoMetadata(ev.target as HTMLVideoElement)}
        onError={ev => handleVideoError(ev)}
        autoPlay
        muted
        playsInline
      />
    </div>
  );
});

VideoPlayer.displayName = 'VideoPlayer';