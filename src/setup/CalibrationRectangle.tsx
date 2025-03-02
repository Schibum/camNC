import React from 'react';
import { Point } from './CameraSetup';

interface CalibrationRectangleProps {
  points: Point[];
  scale: number;
  videoToContainerCoords: (videoX: number, videoY: number) => Point;
}

export const CalibrationRectangle: React.FC<CalibrationRectangleProps> = ({
  points,
  scale,
  videoToContainerCoords
}) => {
  // Only render when all 4 points are selected
  if (points.length !== 4) {
    return null;
  }

  // Map the points to screen coordinates
  const screenPoints = points.map(point => videoToContainerCoords(point[0], point[1]));

  // Arrange points in rectangle order (top-left, top-right, bottom-right, bottom-left)
  const sortedPoints = arrangePointsInRectangleOrder(screenPoints);

  return (
    <>
      {/* Draw the rectangle lines */}
      {drawRectangleLines(sortedPoints, scale)}
    </>
  );
};

// Helper function to arrange points in rectangle order
function arrangePointsInRectangleOrder(points: Point[]): Point[] {
  // Clone points to avoid modifying the original array
  const result = [...points];

  // Sort points by y-coordinate (top to bottom)
  result.sort((a, b) => a[1] - b[1]);

  // Get top two and bottom two points
  const topPoints = [result[0], result[1]];
  const bottomPoints = [result[2], result[3]];

  // Sort top points by x (left to right)
  topPoints.sort((a, b) => a[0] - b[0]);

  // Sort bottom points by x (left to right)
  bottomPoints.sort((a, b) => a[0] - b[0]);

  // Return in order: top-left, top-right, bottom-right, bottom-left
  return [
    topPoints[0],   // top-left
    topPoints[1],   // top-right
    bottomPoints[1], // bottom-right
    bottomPoints[0]  // bottom-left
  ];
}

// Draw rectangle lines connecting the points
function drawRectangleLines(points: Point[], scale: number) {
  // Define style for lines
  const lineStyle: React.CSSProperties = {
    position: 'absolute',
    backgroundColor: 'transparent',
    border: 'none',
    pointerEvents: 'none',
    zIndex: 5,
    transformOrigin: '0 0'
  };

  // Create lines connecting the points (4 sides of the rectangle)
  const lines = [];

  for (let i = 0; i < 4; i++) {
    const currentPoint = points[i];
    const nextPoint = points[(i + 1) % 4]; // Wrap around to first point

    // Calculate line position and dimensions
    const left = Math.min(currentPoint[0], nextPoint[0]);
    const top = Math.min(currentPoint[1], nextPoint[1]);
    const width = Math.abs(nextPoint[0] - currentPoint[0]);
    const height = Math.abs(nextPoint[1] - currentPoint[1]);

    let line;

    // Create horizontal or vertical line
    if (height < 1) {
      // Horizontal line
      line = (
        <div
          key={`line-${i}`}
          style={{
            ...lineStyle,
            left: `${left}px`,
            top: `${top}px`,
            width: `${width}px`,
            height: '0',
            borderTop: `${2/scale}px dashed #00FF00`,
          }}
        />
      );
    } else if (width < 1) {
      // Vertical line
      line = (
        <div
          key={`line-${i}`}
          style={{
            ...lineStyle,
            left: `${left}px`,
            top: `${top}px`,
            width: '0',
            height: `${height}px`,
            borderLeft: `${2/scale}px dashed #00FF00`,
          }}
        />
      );
    } else {
      // Diagonal line (should not happen in a rectangle, but just in case)
      // Using SVG for diagonal lines would be better, but this is a fallback
      const length = Math.sqrt(width * width + height * height);
      const angle = Math.atan2(nextPoint[1] - currentPoint[1], nextPoint[0] - currentPoint[0]) * 180 / Math.PI;

      line = (
        <div
          key={`line-${i}`}
          style={{
            ...lineStyle,
            left: `${currentPoint[0]}px`,
            top: `${currentPoint[1]}px`,
            width: `${length}px`,
            height: '0',
            borderTop: `${2/scale}px dashed #00FF00`,
            transform: `rotate(${angle}deg)`,
            transformOrigin: '0 0',
          }}
        />
      );
    }

    lines.push(line);
  }

  return lines;
}