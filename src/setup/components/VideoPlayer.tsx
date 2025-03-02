import React, { useRef, ForwardedRef, forwardRef, useReducer, useLayoutEffect, useEffect } from 'react';

interface VideoPlayerProps {
  url: string;
  onLoad?: (dimensions: { width: number; height: number }) => void;
  onError?: (error: string) => void;
  containerRef?: React.RefObject<HTMLDivElement>;
  style?: React.CSSProperties;
}

// Action types for the reducer
type State = {
  isLoading: boolean;
  loadError: string | null;
  isInitialized: boolean;
};

type Action =
  | { type: 'LOADING' }
  | { type: 'LOADED' }
  | { type: 'ERROR', message: string }
  | { type: 'RETRY' }
  | { type: 'INITIALIZE' };

// Define a stable reducer function outside the component
const videoReducer = (state: State, action: Action): State => {
  switch (action.type) {
    case 'LOADING':
      return { ...state, isLoading: true, loadError: null, isInitialized: true };
    case 'LOADED':
      return { ...state, isLoading: false };
    case 'ERROR':
      return { ...state, isLoading: false, loadError: action.message };
    case 'RETRY':
      return { ...state, isLoading: true, loadError: null };
    case 'INITIALIZE':
      if (state.isInitialized) return state;
      return { ...state, isInitialized: true };
    default:
      return state;
  }
};

// Component to encapsulate video loading, error handling, and display
export const VideoPlayer = forwardRef((
  { url, onLoad, onError, style = {} }: VideoPlayerProps,
  forwardedRef: ForwardedRef<HTMLVideoElement>
) => {
  // Use reducer to handle state updates more predictably
  const [state, dispatch] = useReducer(videoReducer, {
    isLoading: true,
    loadError: null,
    isInitialized: false
  });

  // Refs don't cause re-renders when updated
  const videoRef = useRef<HTMLVideoElement>(null);
  const previousUrlRef = useRef<string>(url);
  const hasCalledOnLoadRef = useRef<boolean>(false);

  // Function to get the current video element
  const getVideoElement = () => {
    return forwardedRef && typeof forwardedRef === 'object' && forwardedRef.current
      ? forwardedRef.current
      : videoRef.current;
  };

  // Setup ref and initialization
  useLayoutEffect(() => {

    // Initialize on first render
    dispatch({ type: 'INITIALIZE' });

    // Handle ref forwarding
    if (forwardedRef && typeof forwardedRef === 'object') {
      forwardedRef.current = videoRef.current;
    }
  }, []);

  // Handle URL changes
  useLayoutEffect(() => {
    if (previousUrlRef.current !== url) {
      previousUrlRef.current = url;
      dispatch({ type: 'LOADING' });
      hasCalledOnLoadRef.current = false;
    }
  }, [url]);

  // Handle video events
  useLayoutEffect(() => {
    // Video element may not be available immediately
    const videoElement = getVideoElement();
    if (!videoElement) return;

    // Define stable event handlers using refs to avoid recreation
    const handleVideoMetadata = () => {
      if (!videoElement) return;

      dispatch({ type: 'LOADED' });

      // Call onLoad only once per URL change
      if (!hasCalledOnLoadRef.current && onLoad) {
        const { videoWidth, videoHeight } = videoElement;
        onLoad({ width: videoWidth, height: videoHeight });
        hasCalledOnLoadRef.current = true;
      }
    };

    const handleVideoError = (e: Event) => {
      const errorMessage = "Failed to load video. Please check the URL and try again.";
      dispatch({ type: 'ERROR', message: errorMessage });

      if (onError) {
        onError(errorMessage);
      }

      console.error("Video loading error:", e);
    };

    // Add event listeners
    videoElement.addEventListener('loadedmetadata', handleVideoMetadata);
    videoElement.addEventListener('error', handleVideoError);

    // Check if the video is already loaded
    if (videoElement.videoWidth && !hasCalledOnLoadRef.current) {
      handleVideoMetadata();
    }

    // Cleanup
    return () => {
      videoElement.removeEventListener('loadedmetadata', handleVideoMetadata);
      videoElement.removeEventListener('error', handleVideoError);
    };
  }, [url, onLoad, onError]);

  useEffect(() => {
    return () => {
      const videoElement = getVideoElement();
      if (videoElement) {
        videoElement.src = '';
      }
    };
  }, []);
  // Handler for retry button
  const handleRetry = () => {
    const videoElement = getVideoElement();
    if (!videoElement) return;

    dispatch({ type: 'RETRY' });
    videoElement.load();
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
    textAlign: 'center'
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
    maxWidth: '80%'
  } as const;

  return (
    <div style={containerStyle}>
      {/* Loading spinner */}
      {state.isLoading && (
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
      {state.loadError && (
        <div style={errorStyle}>
          <p>{state.loadError}</p>
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
        ref={videoRef}
        src={url}
        style={videoStyle}
        autoPlay
        muted
        playsInline
      />
    </div>
  );
});