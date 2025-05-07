import { ensureOpenCvIsLoaded } from '@wbcnc/load-opencv';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import markersPngPath from '../test/data/markers.png';
import markersOnWhitePngPath from '../test/data/markers_on_white.jpg';
import { detectAruco } from './detect-aruco';
// Avoid dynamic import of ensureOpenCvIsLoaded

function loadImage(path: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.src = path;
  return new Promise((resolve, reject) => {
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load image'));
  });
}

function imgAsCanvas(img: HTMLImageElement) {
  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Failed to get canvas context');
  ctx.drawImage(img, 0, 0);
  return canvas;
}

describe('detectAruco', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await ensureOpenCvIsLoaded();
  });

  it('should detect arucos', async () => {
    const canvas = imgAsCanvas(await loadImage(markersPngPath));
    const markers = detectAruco(canvas);
    expect(markers).toEqual([
      {
        id: 0,
        origin: expect.arrayContaining([expect.closeTo(53.5, 0.1), expect.closeTo(204.7, 0.1)]),
      },
      {
        id: 1,
        origin: expect.arrayContaining([expect.closeTo(3308.8, 0.1), expect.closeTo(43.8, 0.1)]),
      },
      {
        id: 2,
        origin: expect.arrayContaining([expect.closeTo(3380.4, 0.1), expect.closeTo(1689.0, 0.1)]),
      },
      {
        id: 3,
        origin: expect.arrayContaining([expect.closeTo(139.0, 0.1), expect.closeTo(1884.0, 0.1)]),
      },
    ]);
  });

  it('should detect arucos on white', async () => {
    const canvas = imgAsCanvas(await loadImage(markersOnWhitePngPath));
    const markers = detectAruco(canvas);
    expect(markers).toEqual([
      {
        id: 0,
        origin: expect.arrayContaining([expect.closeTo(11.5, 0.1), expect.closeTo(112.3, 0.1)]),
      },
      {
        id: 1,
        origin: expect.arrayContaining([expect.closeTo(111.7, 0.1), expect.closeTo(108.7, 0.1)]),
      },
      {
        id: 2,
        origin: expect.arrayContaining([expect.closeTo(215.6, 0.1), expect.closeTo(104.9, 0.1)]),
      },
      {
        id: 3,
        origin: expect.arrayContaining([expect.closeTo(311.3, 0.1), expect.closeTo(102.1, 0.1)]),
      },
    ]);
  });
});
