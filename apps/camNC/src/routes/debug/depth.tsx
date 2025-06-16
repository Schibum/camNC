import { useStockSelection } from '@/hooks/useStockSelection';
import { useDepthData } from '@/store/store';
import { depthFloodFillMask } from '@/utils/depthMask';
import { createFileRoute } from '@tanstack/react-router';
import { Button } from '@wbcnc/ui/components/button';
import { PageHeader } from '@wbcnc/ui/components/page-header';
import { useEffect, useRef, useState } from 'react';

export const Route = createFileRoute('/debug/depth')({
  component: DepthDebugRoute,
});

function DepthDebugRoute() {
  const { start } = useStockSelection();
  const depth = useDepthData();

  return (
    <div className="relative w-full h-full p-4 space-y-4">
      <PageHeader title="Depth Map" />
      <div className="flex gap-4 items-center">
        <Button onClick={start}>Capture</Button>
        {depth && (
          <span className="text-sm text-gray-400">
            {depth.width}×{depth.height}
          </span>
        )}
      </div>

      <DepthAndMaskViewer depth={depth} />
    </div>
  );
}

interface DepthProps {
  depth: ReturnType<typeof useDepthData>;
}

function DepthAndMaskViewer({ depth }: DepthProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const maskCanvasRef = useRef<HTMLCanvasElement>(null);
  const [lastHits, setLastHits] = useState<number | null>(null);

  // Draw depth map whenever it changes
  useEffect(() => {
    if (!depth) return;
    const { data, width, height } = depth;
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Compute min and max to scale values to 0-255
    let minVal = Infinity;
    let maxVal = -Infinity;
    for (let i = 0; i < data.length; i++) {
      const v = data[i];
      if (v < minVal) minVal = v;
      if (v > maxVal) maxVal = v;
    }
    const range = maxVal - minVal || 1;

    const imgData = ctx.createImageData(width, height);
    for (let i = 0; i < data.length; i++) {
      const norm = (data[i] - minVal) / range; // 0 .. 1
      const val = Math.max(0, Math.min(255, Math.round(norm * 255)));
      const idx = i * 4;
      imgData.data[idx] = val;
      imgData.data[idx + 1] = val;
      imgData.data[idx + 2] = val;
      imgData.data[idx + 3] = 255; // alpha
    }
    ctx.putImageData(imgData, 0, 0);

    // Clear mask when depth map updates
    const mCanvas = maskCanvasRef.current;
    if (mCanvas) {
      mCanvas.width = width;
      mCanvas.height = height;
      const mCtx = mCanvas.getContext('2d');
      mCtx?.clearRect(0, 0, width, height);
    }
  }, [depth]);

  // Click handler to build & show displacement mask
  const handleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!depth) return;
    const rect = (e.target as HTMLCanvasElement).getBoundingClientRect();
    const x = Math.floor(((e.clientX - rect.left) / rect.width) * depth.width);
    const y = Math.floor(((e.clientY - rect.top) / rect.height) * depth.height);
    console.log('x, y', x, y);

    if (x < 0 || x >= depth.width || y < 0 || y >= depth.height) return;

    const { data, width, height } = depth;
    const idx = y * width + x;
    const { mask, hits } = depthFloodFillMask(data, width, height, idx, { threshold: 0.01 });

    const maskImg = new ImageData(width, height);
    for (let i = 0; i < mask.length; i++) {
      const v = mask[i];
      const id = i * 4;
      maskImg.data[id] = v; // red channel
      maskImg.data[id + 1] = 0;
      maskImg.data[id + 2] = 0;
      maskImg.data[id + 3] = 255;
    }

    const mCanvas = maskCanvasRef.current;
    if (mCanvas) {
      mCanvas.width = width;
      mCanvas.height = height;
      const mCtx = mCanvas.getContext('2d');
      if (mCtx) mCtx.putImageData(maskImg, 0, 0);
    }
    setLastHits(hits);
  };

  if (!depth) return <p className="text-gray-500">No depth map present. Click "Capture" to estimate.</p>;

  return (
    <div className="flex flex-col gap-4">
      <canvas ref={canvasRef} onClick={handleClick} className="border border-gray-300 cursor-crosshair" />
      <div className="flex flex-col">
        <span className="text-xs text-gray-500">
          Mask (red) – click on depth map to generate{lastHits !== null && `; hits: ${lastHits}`}
        </span>
        <canvas ref={maskCanvasRef} className="border border-red-400" />
      </div>
    </div>
  );
}
