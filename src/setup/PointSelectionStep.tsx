import React, { useState, useRef, useEffect } from 'react';
import { VideoPlayer } from './VideoPlayer';
import { ActionButtons } from './ActionButtons';
import { NextPointNotification } from './NextPointNotification';
import { CalibrationRectangle } from './CalibrationRectangle';
import { PointMarker } from './PointMarker';
import { IBox, IPoint } from '../atoms';

interface PointSelectionStepProps {
  url: string;
  initialPoints: IBox | [];
  onSave: (points: IBox) => void;
  onReset: () => void;
  onVideoLoad?: (width: number, height: number) => void;
}

export const PointSelectionStep: React.FC<PointSelectionStepProps> = ({
  url,
  initialPoints = [],
  onSave,
  onReset,
  onVideoLoad
}) => {
  const [points, setPoints] = useState<IPoint[]>(initialPoints);
  const [videoSize, setVideoSize] = useState({ width: 0, height: 0 });
  const [videoDisplayRect, setVideoDisplayRect] = useState({ x: 0, y: 0, width: 0, height: 0 });

  // State for handling loading and errors but delegating rendering to VideoPlayer
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Refs and state for pan/zoom functionality
  const containerRef = useRef<HTMLDivElement>(null);
  const videoContainerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [translate, setTranslate] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });
  const [draggingPointIndex, setDraggingPointIndex] = useState<number | null>(null);
  const [hasMoved, setHasMoved] = useState(false);

  // Calculate the actual displayed video rect (accounting for letterboxing/pillarboxing)
  const calculateVideoDisplayRect = () => {
    if (!containerRef.current || !videoSize.width || !videoSize.height) return;

    const containerWidth = containerRef.current.clientWidth;
    const containerHeight = containerRef.current.clientHeight;

    // Calculate aspect ratios
    const containerAspect = containerWidth / containerHeight;
    const videoAspect = videoSize.width / videoSize.height;

    let displayWidth, displayHeight, offsetX, offsetY;

    if (videoAspect > containerAspect) {
      // Video is wider than container (letterboxing - black bars on top and bottom)
      displayWidth = containerWidth;
      displayHeight = containerWidth / videoAspect;
      offsetX = 0;
      offsetY = (containerHeight - displayHeight) / 2;
    } else {
      // Video is taller than container (pillarboxing - black bars on sides)
      displayHeight = containerHeight;
      displayWidth = containerHeight * videoAspect;
      offsetX = (containerWidth - displayWidth) / 2;
      offsetY = 0;
    }

    setVideoDisplayRect({
      x: offsetX,
      y: offsetY,
      width: displayWidth,
      height: displayHeight
    });

  };

  // Update video display rect when video or container size changes
  useEffect(() => {
    calculateVideoDisplayRect();

    // Set up resize observer for container size changes
    const resizeObserver = new ResizeObserver(() => {
      calculateVideoDisplayRect();
    });

    if (containerRef.current) {
      resizeObserver.observe(containerRef.current);
    }

    return () => {
      resizeObserver.disconnect();
    };
  }, [videoSize.width, videoSize.height]);

  // Handle zooming with mouse wheel
  const handleWheel = (e: WheelEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const delta = -e.deltaY;
    const zoomFactor = delta > 0 ? 1.1 : 0.9;
    const newScale = scale * zoomFactor;

    // Get mouse pointer position relative to container
    if (containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      // Adjust translation to center zoom around pointer
      const newTranslate = {
        x: mouseX - (mouseX - translate.x) * (newScale / scale),
        y: mouseY - (mouseY - translate.y) * (newScale / scale)
      };

      setScale(newScale);
      setTranslate(newTranslate);
    }
  };

  // Add wheel event listener with passive: false option
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

  // Convert container coordinates to video coordinates based on visible video area
  const containerToVideoCoords = (containerX: number, containerY: number): IPoint => {
    // Get the coordinates in the transformed/scaled container space
    const x = (containerX - translate.x) / scale;
    const y = (containerY - translate.y) / scale;

    // Account for the video's position within the container (letterboxing/pillarboxing)
    if (videoDisplayRect.width && videoDisplayRect.height) {
      // Adjust for offsets to get coordinates relative to the actual video display area
      const videoRelativeX = x - videoDisplayRect.x;
      const videoRelativeY = y - videoDisplayRect.y;

      // Normalize to the video display area dimensions (0-1 range)
      const normalizedX = videoRelativeX / videoDisplayRect.width;
      const normalizedY = videoRelativeY / videoDisplayRect.height;

      // Map to source video dimensions (this makes bottom-right corner videoWidth x videoHeight)
      return [
        normalizedX * videoSize.width,
        normalizedY * videoSize.height
      ];
    }

    // Fallback
    return [x, y];
  };

  // Convert video coordinates to container coordinates for display
  const videoToContainerCoords = (videoX: number, videoY: number): IPoint => {
    if (videoDisplayRect.width && videoDisplayRect.height && videoSize.width && videoSize.height) {
      // Normalize to 0-1 range based on source video dimensions
      const normalizedX = videoX / videoSize.width;
      const normalizedY = videoY / videoSize.height;

      // Map to visible area
      const visibleX = normalizedX * videoDisplayRect.width;
      const visibleY = normalizedY * videoDisplayRect.height;

      // Add offsets for letterboxing/pillarboxing
      const x = videoDisplayRect.x + visibleX;
      const y = videoDisplayRect.y + visibleY;

      return [x, y];
    }

    // Fallback
    return [videoX, videoY];
  };

  // Start panning if clicking on background
  const handleMouseDown = (e: React.MouseEvent) => {
    // @ts-ignore - dataset may exist on target
    if (!e.target.dataset?.pointIndex) {
      setIsPanning(true);
      setPanStart({ x: e.clientX, y: e.clientY });
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
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

    if (draggingPointIndex !== null && containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      // Convert to video coordinates
      const videoCoords = containerToVideoCoords(mouseX, mouseY);

      // Validate that coordinates are within video bounds
      const boundedCoords: IPoint = [
        Math.max(0, Math.min(videoSize.width, videoCoords[0])),
        Math.max(0, Math.min(videoSize.height, videoCoords[1]))
      ];

      setPoints(prev => {
        const updated = [...prev];
        updated[draggingPointIndex] = boundedCoords;
        return updated;
      });
    }
  };

  const handleMouseUp = () => {
    setIsPanning(false);
    setDraggingPointIndex(null);
    // Reset cursor style
    document.body.style.cursor = '';
    // Reset hasMoved after a short delay to allow click handler to check it
    setTimeout(() => setHasMoved(false), 10);
  };

  // Add a new point if fewer than four exist
  const handleContainerClick = (e: React.MouseEvent) => {
    // Don't place a point if we were just panning or if we're dragging a point
    if (draggingPointIndex !== null || hasMoved) return;

    if (e.target === containerRef.current && points.length < 4 && containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      // Convert to video coordinates
      const videoCoords = containerToVideoCoords(mouseX, mouseY);

      // Validate that coordinates are within video bounds
      const boundedCoords: IPoint = [
        Math.max(0, Math.min(videoSize.width, videoCoords[0])),
        Math.max(0, Math.min(videoSize.height, videoCoords[1]))
      ];

      setPoints([...points, boundedCoords]);
    }
  };

  const handlePointMouseDown = (index: number, e: React.MouseEvent) => {
    e.stopPropagation();
    setDraggingPointIndex(index);
    // Add a class to the body to prevent cursor changes during dragging
    document.body.style.cursor = 'grabbing';
  };

  const handleSave = () => {
    if (points.length !== 4) {
      console.error('Points must be 4');
      return;
    }
    if (onSave) {
      // Points are already in source video coordinates, so no need to transform
      onSave(points as IBox);
    }
  };

  // Handle video load and error events
  const handleVideoLoad = (dimensions: { width: number; height: number }) => {
    setVideoSize(dimensions);
    setIsLoading(false);
    if (onVideoLoad) {
      onVideoLoad(dimensions.width, dimensions.height);
    }
  };

  const handleVideoError = (error: string) => {
    setLoadError(error);
    setIsLoading(false);
  };

  // Use this callback with the VideoPlayer component's "Change URL" button
  const handleChangeUrl = () => {
    onReset();
  };

  // Styles for the container and content
  const containerStyle: React.CSSProperties = {
    position: 'relative',
    overflow: 'hidden',
    width: '800px',
    height: '450px',
    backgroundColor: '#000',
    cursor: draggingPointIndex !== null ? 'grabbing' : (isPanning ? 'grabbing' : 'default'),
  };

  const contentStyle: React.CSSProperties = {
    transform: `translate(${translate.x}px, ${translate.y}px) scale(${scale})`,
    transformOrigin: '0 0',
    position: 'absolute',
    pointerEvents: 'none',
    top: 0,
    left: 0,
    width: '100%',
    height: '100%'
  };

  // Additional style for video container to reinforce the panning ability
  const videoWrapperStyle: React.CSSProperties = {
    width: '100%',
    height: '100%',
    cursor: 'inherit'
  };

  return (
    <div className="point-selection-step">
      <h2>Step 2: Select Reference Points</h2>
      <p>Click on the video to place 4 reference points. You can drag points to adjust them.</p>


      {/* Video container with pan and zoom */}
      <div style={{ position: 'relative' }}>
        {/* Use NextPointNotification component */}
        <NextPointNotification pointCount={points.length} />

        <div
          ref={containerRef}
          style={containerStyle}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onClick={handleContainerClick}
        >
          <div style={contentStyle}>
            <div ref={videoContainerRef} style={videoWrapperStyle}>
              {/* Use the VideoPlayer component */}
              <VideoPlayer
                url={url}
                onLoad={handleVideoLoad}
                onError={handleVideoError}
                style={{ width: '100%', height: '100%', objectFit: 'contain' }}
              />
            </div>

            {points.map((pt, index) => (
              <PointMarker
                key={index}
                index={index}
                x={pt[0]}
                y={pt[1]}
                scale={scale}
                videoToContainerCoords={videoToContainerCoords}
                onMouseDown={handlePointMouseDown}
              />
            ))}

            {/* Display rectangle connecting the points when all 4 are selected */}
            <CalibrationRectangle
              points={points}
              scale={scale}
              videoToContainerCoords={videoToContainerCoords}
            />
          </div>
        </div>
      </div>

      {/* Use ActionButtons component */}
      <ActionButtons
        onReset={onReset}
        onSave={handleSave}
        canSave={points.length === 4}
        saveDisabled={isLoading || !!loadError}
      />
    </div>
  );
};