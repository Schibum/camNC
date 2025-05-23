import { cv2, ensureOpenCvIsLoaded } from '@wbcnc/load-opencv';
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

function imgAsMat(img: HTMLImageElement) {
  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Failed to get canvas context');
  ctx.drawImage(img, 0, 0);
  return cv2.imread(canvas);
}

describe('detectAruco', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await ensureOpenCvIsLoaded();
  });

  it('should detect arucos', async () => {
    const img = imgAsMat(await loadImage(markersPngPath));
    const markers = detectAruco(img);
    img.delete();
    expect(markers.map(m => m.id)).toEqual([0, 1, 2, 3]);
    expect(markers[0].origin.x).toBeCloseTo(53.5, 0.1);
    expect(markers[0].origin.y).toBeCloseTo(204.7, 0.1);
    expect(markers[1].origin.x).toBeCloseTo(3308.8, 0.1);
    expect(markers[1].origin.y).toBeCloseTo(43.8, 0.1);
    expect(markers[2].origin.x).toBeCloseTo(3380.4, 0.1);
    expect(markers[2].origin.y).toBeCloseTo(1689.0, 0.1);
    expect(markers[3].origin.x).toBeCloseTo(139.0, 0.1);
  });

  it('should detect arucos on white', async () => {
    const img = imgAsMat(await loadImage(markersOnWhitePngPath));
    const markers = detectAruco(img);
    img.delete();
    expect(markers.map(m => m.id)).toEqual([0, 1, 2, 3]);
    expect(markers[0].origin.x).toBeCloseTo(11.5, 0.1);
    expect(markers[0].origin.y).toBeCloseTo(112.3, 0.1);
    expect(markers[1].origin.x).toBeCloseTo(111.7, 0.1);
    expect(markers[1].origin.y).toBeCloseTo(108.7, 0.1);
    expect(markers[2].origin.x).toBeCloseTo(215.6, 0.1);
  });
});
