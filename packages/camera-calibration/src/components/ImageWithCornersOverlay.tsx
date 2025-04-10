import { useEffect, useRef } from 'react';
import { Corner } from '../lib/calibrationTypes';
import { useObjectURL } from '../hooks/useObjectURL';

interface ImageWithCornersOverlayProps {
  imageBlob: Blob | null;
  corners: Corner[];
  className?: string;
  cornerColor?: string;
  cornerSize?: number;
}

export const ImageWithCornersOverlay: React.FC<ImageWithCornersOverlayProps> = ({
  imageBlob,
  corners,
  className = '',
  cornerColor = '#ff00ff',
  cornerSize = 5
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageUrl = useObjectURL(imageBlob);

  // Render corners on canvas when frame image is loaded
  useEffect(() => {
    if (!imageUrl || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const img = new Image();
    img.onload = () => {
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      ctx.drawImage(img, 0, 0);

      // Draw corners
      ctx.strokeStyle = cornerColor;
      ctx.lineWidth = 2;
      ctx.fillStyle = cornerColor;

      corners.forEach(corner => {
        ctx.beginPath();
        ctx.arc(corner.x, corner.y, cornerSize, 0, 2 * Math.PI);
        ctx.fill();
      });
    };
    img.onerror = () => {
      console.error('Failed to load image for corner overlay:', imageUrl);
    };
    img.src = imageUrl;
  }, [imageUrl, corners, cornerColor, cornerSize]);

  if (!imageUrl) {
    return <div className="text-center text-gray-400">Loading image...</div>;
  }

  return (
    <canvas ref={canvasRef} className={className} />
  );
};