import React, { useState, useRef, useEffect } from 'react';

interface Point {
  x: number;
  y: number;
}

interface CameraSetupProps {
  initialUrl?: string;
  initialPoints?: Point[];
  onSave: (data: { url: string; points: Point[] }) => void;
}

const CameraSetup = ({ initialUrl = '', initialPoints = [], onSave }: CameraSetupProps) => {
  const [url, setUrl] = useState(initialUrl);
  const [points, setPoints] = useState(initialPoints);
  const [videoSize, setVideoSize] = useState({ width: 0, height: 0 });
  const videoRef = useRef(null);

  // Pan and zoom state.
  const [scale, setScale] = useState(1);
  const [translate, setTranslate] = useState({ x: 0, y: 0 });
  const containerRef = useRef(null);
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });
  const [draggingPointIndex, setDraggingPointIndex] = useState(null);

  // Track if we've moved during panning to prevent point placement on mouse up
  const [hasMoved, setHasMoved] = useState(false);

  // Track video dimensions when loaded
  useEffect(() => {
    const handleVideoMetadata = () => {
      if (videoRef.current) {
        const { videoWidth, videoHeight } = videoRef.current;
        setVideoSize({ width: videoWidth, height: videoHeight });
      }
    };

    const videoElement = videoRef.current;
    if (videoElement) {
      videoElement.addEventListener('loadedmetadata', handleVideoMetadata);

      // If video is already loaded, get dimensions immediately
      if (videoElement.videoWidth) {
        handleVideoMetadata();
      }

      return () => {
        videoElement.removeEventListener('loadedmetadata', handleVideoMetadata);
      };
    }
  }, [url]);

  // Convert container coordinates to video coordinates
  const containerToVideoCoords = (containerX, containerY) => {
    // Get the coordinates in the transformed/scaled container space
    const x = (containerX - translate.x) / scale;
    const y = (containerY - translate.y) / scale;

    // Now normalize to video dimensions if we have them
    if (containerRef.current && videoSize.width && videoSize.height) {
      const container = containerRef.current;
      const containerWidth = container.clientWidth;
      const containerHeight = container.clientHeight;

      // Calculate the normalized coordinates (0-1 range)
      const normalizedX = x / containerWidth;
      const normalizedY = y / containerHeight;

      // Map to video dimensions
      return {
        x: normalizedX * videoSize.width,
        y: normalizedY * videoSize.height
      };
    }

    // Fallback if video dimensions aren't available yet
    return { x, y };
  };

  // Convert video coordinates to container coordinates for display
  const videoToContainerCoords = (videoX, videoY) => {
    if (containerRef.current && videoSize.width && videoSize.height) {
      const container = containerRef.current;
      const containerWidth = container.clientWidth;
      const containerHeight = container.clientHeight;

      // Normalize to container dimensions
      const x = (videoX / videoSize.width) * containerWidth;
      const y = (videoY / videoSize.height) * containerHeight;

      return { x, y };
    }

    // Fallback
    return { x: videoX, y: videoY };
  };

  // Handle zooming with mouse wheel.
  const handleWheel = (e) => {
    e.preventDefault();
    e.stopPropagation();
    const delta = -e.deltaY;
    const zoomFactor = delta > 0 ? 1.1 : 0.9;
    const newScale = scale * zoomFactor;

    // Get mouse pointer position relative to container.
    const rect = containerRef.current.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    // Adjust translation to center zoom around pointer.
    const newTranslate = {
      x: mouseX - (mouseX - translate.x) * (newScale / scale),
      y: mouseY - (mouseY - translate.y) * (newScale / scale)
    };

    setScale(newScale);
    setTranslate(newTranslate);
  };

  // Use effect to add wheel event listener with passive: false option
  useEffect(() => {
    const container = containerRef.current;
    if (container) {
      // Add wheel event listener with passive: false to ensure preventDefault works
      container.addEventListener('wheel', handleWheel, { passive: false });

      // Cleanup
      return () => {
        container.removeEventListener('wheel', handleWheel);
      };
    }
  }, [scale, translate]); // Re-add listener when scale or translate changes

  // Start panning if clicking on background.
  const handleMouseDown = (e) => {
    if (!e.target.dataset.pointIndex) {
      setIsPanning(true);
      setPanStart({ x: e.clientX, y: e.clientY });
    }
  };

  const handleMouseMove = (e) => {
    if (isPanning) {
      const dx = e.clientX - panStart.x;
      const dy = e.clientY - panStart.y;

      // If we've moved more than a small threshold, mark as moved
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
        setHasMoved(true);
      }

      setPanStart({ x: e.clientX, y: e.clientY });
      setTranslate(prev => ({ x: prev.x + dx, y: prev.y + dy }));
    }
    if (draggingPointIndex !== null) {
      const rect = containerRef.current.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      // Convert to video coordinates
      const videoCoords = containerToVideoCoords(mouseX, mouseY);

      setPoints(prev => {
        const updated = [...prev];
        updated[draggingPointIndex] = videoCoords;
        return updated;
      });
    }
  };

  const handleMouseUp = () => {
    setIsPanning(false);
    setDraggingPointIndex(null);
    // Reset hasMoved after a short delay to allow click handler to check it
    setTimeout(() => setHasMoved(false), 10);
  };

  // Add a new point if fewer than four exist.
  const handleContainerClick = (e) => {
    // Don't place a point if we were just panning or if we're dragging a point
    if (draggingPointIndex !== null || hasMoved) return;

    if (e.target === containerRef.current && points.length < 4) {
      const rect = containerRef.current.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      // Convert to video coordinates
      const videoCoords = containerToVideoCoords(mouseX, mouseY);
      setPoints([...points, videoCoords]);
    }
  };

  const handlePointMouseDown = (index, e) => {
    e.stopPropagation();
    setDraggingPointIndex(index);
  };

  const handleSave = () => {
    if (onSave) {
      onSave({ url, points });
    }
  };

  // Styles for the container and the content inside (video and overlays).
  const containerStyle: React.CSSProperties = {
    position: 'relative' as const,
    overflow: 'hidden',
    width: '800px',
    height: '450px',
    backgroundColor: '#000'
  };

  const contentStyle: React.CSSProperties = {
    transform: `translate(${translate.x}px, ${translate.y}px) scale(${scale})`,
    transformOrigin: '0 0',
    position: 'absolute' as const,
    pointerEvents: 'none',
    top: 0,
    left: 0,
    width: '100%',
    height: '100%'
  };

  // Render a cross marker at the specified point.
  const CrossMarker = ({ x, y, index }) => {
    const markerSize = 16;
    const offset = markerSize / 2;

    // Convert video coordinates to container coordinates for display
    const containerCoords = videoToContainerCoords(x, y);

    // Define point labels
    const pointLabels = [
      '1: (xmin, ymin)',
      '2: (xmin, ymax)',
      '3: (xmax, ymin)',
      '4: (xmax, ymax)'
    ];

    return (
      <div
        data-point-index={index}
        onMouseDown={(e) => handlePointMouseDown(index, e)}
        style={{
          position: 'absolute',
          left: containerCoords.x - offset,
          top: containerCoords.y - offset,
          width: markerSize,
          height: markerSize,
          cursor: 'pointer',
          pointerEvents: 'all',
          transform: `scale(${1/scale})`,
          transformOrigin: '50% 50%'
        }}
      >
        {/* Vertical line */}
        <div
          style={{
            position: 'absolute',
            left: '50%',
            top: 0,
            width: 1,
            height: '100%',
            backgroundColor: 'red',
            transform: 'translateX(-50%)'
          }}
        />
        {/* Horizontal line */}
        <div
          style={{
            position: 'absolute',
            top: '50%',
            left: 0,
            width: '100%',
            height: 1,
            backgroundColor: 'red',
            transform: 'translateY(-50%)'
          }}
        />
        {/* Point label */}
        <div
          style={{
            position: 'absolute',
            left: markerSize + 4,
            top: -10,
            color: 'red',
            fontSize: '14px',
            whiteSpace: 'nowrap',
            pointerEvents: 'none',
            textShadow: '1px 1px 1px black'
          }}
        >
          {pointLabels[index]} ({Math.round(x)}, {Math.round(y)})
        </div>
      </div>
    );
  };

  // Get the label for the next point to be placed
  const getNextPointLabel = () => {
    const nextLabels = [
      '1: (xmin, ymin)',
      '2: (xmin, ymax)',
      '3: (xmax, ymin)',
      '4: (xmax, ymax)'
    ];
    return points.length < 4 ? nextLabels[points.length] : null;
  };

  return (
    <div>
      {/* URL input */}
      <div style={{ marginBottom: '10px' }}>
        <input
          type="text"
          placeholder="Enter video stream URL"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          style={{ width: '400px' }}
        />
      </div>

      {/* Video dimensions display */}
      {videoSize.width > 0 && (
        <div style={{ marginBottom: '10px', fontSize: '14px', color: '#666' }}>
          Video dimensions: {videoSize.width} × {videoSize.height}
        </div>
      )}

      {/* Video container with pan and zoom */}
      {url && (
        <div style={{ position: 'relative' }}>
          {points.length < 4 && url && (
            <div style={{
              position: 'absolute',
              top: -25,
              left: 0,
              color: '#666',
              pointerEvents: 'none',
              zIndex: 1,
              backgroundColor: 'rgba(255, 255, 255, 0.8)',
              padding: '2px 6px',
              borderRadius: '4px'
            }}>
              Next point to select: {getNextPointLabel()}
            </div>
          )}
          <div
            ref={containerRef}
            style={containerStyle}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onClick={handleContainerClick}
          >
            <div style={contentStyle}>
              <video
                ref={videoRef}
                src={url}
                style={{ width: '100%', height: '100%'}}
                autoPlay
                muted
                playsInline
              />
              {points.map((pt, index) => (
                <CrossMarker key={index} index={index} x={pt.x} y={pt.y} />
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Save button appears when exactly four points have been selected */}
      {points.length === 4 && (
        <button onClick={handleSave} style={{ marginTop: '10px' }}>
          Save
        </button>
      )}
    </div>
  );
};

export default CameraSetup;
