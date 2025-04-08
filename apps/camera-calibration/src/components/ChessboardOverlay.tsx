import { useRef, useEffect } from 'react';
import { Corner, PatternSize } from '../lib/calibrationTypes';



/**
 * Draws chessboard corners and connecting lines onto a canvas context.
 *
 * @param ctx The 2D canvas rendering context.
 * @param corners Array of corner points ({ x, y }).
 * @param patternSize The dimensions of the chessboard pattern (inner corners).
 * @param scale Scaling factor to apply to corner coordinates.
 * @param lineWidth Width of the connecting lines (default: 4).
 * @param pointSize Diameter of the corner points (default: 3).
 */
export function drawChessboardCorners(
  ctx: CanvasRenderingContext2D,
  corners: Corner[],
  patternSize: PatternSize,
  scale: number,
  lineWidth = 4,
  pointSize = 6
): void {

  const { width: patternWidth, height: patternHeight } = patternSize;

  if (corners.length !== patternWidth * patternHeight) {
    console.warn(
      `[drawChessboardCorners] Mismatch between corners length (${corners.length}) and pattern size (${patternWidth}x${patternHeight})`
    );
    return; // Don't draw if data seems inconsistent
  }

  ctx.strokeStyle = 'lightgreen';
  ctx.lineWidth = lineWidth;
  ctx.fillStyle = 'hotpink';

  // Draw lines horizontally
  for (let row = 0; row < patternHeight; row++) {
    for (let col = 0; col < patternWidth - 1; col++) {
      const idx1 = row * patternWidth + col;
      const idx2 = idx1 + 1;
      const c1 = corners[idx1];
      const c2 = corners[idx2];
      ctx.beginPath();
      ctx.moveTo(c1.x * scale, c1.y * scale);
      ctx.lineTo(c2.x * scale, c2.y * scale);
      ctx.stroke();
    }
  }

  // Draw lines vertically
  for (let col = 0; col < patternWidth; col++) {
    for (let row = 0; row < patternHeight - 1; row++) {
      const idx1 = row * patternWidth + col;
      const idx2 = idx1 + patternWidth;
      const c1 = corners[idx1];
      const c2 = corners[idx2];
      ctx.beginPath();
      ctx.moveTo(c1.x * scale, c1.y * scale);
      ctx.lineTo(c2.x * scale, c2.y * scale);
      ctx.stroke();
    }
  }

  // Draw corner points
  corners.forEach(corner => {
    ctx.beginPath();
    ctx.arc(corner.x * scale, corner.y * scale, pointSize, 0, 2 * Math.PI);
    ctx.fill();
  });
}

interface ChessboardOverlayProps {
  corners: Corner[] | null;
  patternSize: PatternSize | null;
  frameWidth: number;
  frameHeight: number;
  lineWidth?: number;
  pointSize?: number;
}

export const ChessboardOverlay: React.FC<ChessboardOverlayProps> = ({
  corners,
  patternSize,
  frameWidth,
  frameHeight,
  lineWidth,
  pointSize,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Effect to draw corners onto the canvas when they update
  useEffect(() => {
    if (!canvasRef.current || !frameWidth || !frameHeight || !patternSize) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Clear canvas before drawing
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw corners if they exist
    if (corners && corners.length > 0) {
      const scale = canvas.width / frameWidth;
      drawChessboardCorners(ctx, corners, patternSize, scale, lineWidth, pointSize);
    }
  }, [corners, frameWidth, frameHeight, patternSize, lineWidth, pointSize]);

  return (
    <canvas
      ref={canvasRef}
      width={frameWidth}
      height={frameHeight}
      className="absolute top-0 left-0 w-full h-full object-contain pointer-events-none"
    />
  );
};