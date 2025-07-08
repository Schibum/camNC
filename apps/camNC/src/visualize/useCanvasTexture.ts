import { useLayoutEffect, useRef, useState } from 'react';
import { CanvasTexture, LinearFilter } from 'three';

export interface CanvasTextureHandle {
  texture: CanvasTexture;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
}

/**
 * useCanvasTexture manages a CanvasTexture whose size is driven by the
 * `width` / `height` parameters. Whenever the requested dimensions change, the
 * hook disposes the old GPU texture and allocates a new one; the caller is
 * responsible for drawing onto the returned 2-D context.
 */
export function useCanvasTexture(width: number, height: number): CanvasTextureHandle {
  const [texture, setTexture] = useState(() => new CanvasTexture(document.createElement('canvas')));
  const canvasRef = useRef<HTMLCanvasElement>(texture.image as HTMLCanvasElement);
  const ctxRef = useRef<CanvasRenderingContext2D>(canvasRef.current.getContext('2d')!);

  useLayoutEffect(() => {
    if (canvasRef.current.width === width && canvasRef.current.height === height) return;

    // Dispose old GPU texture to free memory
    texture.dispose();

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const newTex = new CanvasTexture(canvas);
    newTex.minFilter = LinearFilter;
    newTex.magFilter = LinearFilter;
    newTex.generateMipmaps = false;

    canvasRef.current = canvas;
    ctxRef.current = canvas.getContext('2d')!;
    setTexture(newTex);
  }, [width, height, texture]);

  return {
    texture,
    canvas: canvasRef.current,
    ctx: ctxRef.current,
  };
}
