import React from 'react';
import { IPoint } from '../atoms';

interface PointMarkerProps {
  x: number;
  y: number;
  index: number;
  scale: number;
  videoToContainerCoords: (videoX: number, videoY: number) => IPoint;
  onMouseDown: (index: number, e: React.MouseEvent) => void;
}

export const PointMarker: React.FC<PointMarkerProps> = ({
  x,
  y,
  index,
  scale,
  videoToContainerCoords,
  onMouseDown
}) => {
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
      onMouseDown={(e) => onMouseDown(index, e)}
      style={{
        position: 'absolute',
        left: containerCoords[0] - offset,
        top: containerCoords[1]- offset,
        width: markerSize,
        height: markerSize,
        cursor: 'grab',
        pointerEvents: 'all',
        transform: `scale(${1/scale})`,
        transformOrigin: '50% 50%',
        zIndex: 10
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