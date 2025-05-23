import { calculateUndistortionMapsCached } from '@/calibration/rectifyMap';
import { remapCv } from '@/calibration/remapCv';
import { detectAruco } from '@/setup/detect-aruco';
import type { CalibrationData } from '@/store/store';
import { ensureOpenCvIsLoaded } from '@wbcnc/load-opencv';
import * as Comlink from 'comlink';

/**
 * Worker API exposed via Comlink.
 */
export interface MarkerScannerWorkerAPI {
  init(
    reader: ReadableStream<VideoFrame>,
    calibrationData: CalibrationData,
    resolution: [number, number],
    averageFrames: number
  ): Promise<void>;
  scan(): Promise<{ id: number; origin: { x: number; y: number } }[]>;
}

/**
 * Converts a VideoFrame to ImageData using OffscreenCanvas
 */
async function frameToImageData(
  frame: VideoFrame,
  width: number,
  height: number,
  ctx: OffscreenCanvasRenderingContext2D
): Promise<ImageData> {
  const bitmap = await createImageBitmap(frame);
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  frame.close();
  return ctx.getImageData(0, 0, width, height);
}

/**
 * Accumulates pixel data into a running average
 */
function accumulatePixelData(
  imageData: ImageData,
  runningAverage: Float32Array | null,
  count: number
): { average: Float32Array; newCount: number } {
  const data = imageData.data;

  if (!runningAverage) {
    const average = new Float32Array(data.length);
    for (let i = 0; i < data.length; i++) {
      average[i] = data[i];
    }
    return { average, newCount: 1 };
  }

  const newCount = count + 1;
  for (let i = 0; i < data.length; i++) {
    runningAverage[i] += (data[i] - runningAverage[i]) / newCount;
  }
  return { average: runningAverage, newCount };
}

/**
 * Converts Float32Array to Uint8ClampedArray for ImageData
 */
function convertToImageData(runningAverage: Float32Array, width: number, height: number): ImageData {
  const finalBuffer = new Uint8ClampedArray(runningAverage.length);
  for (let i = 0; i < runningAverage.length; i++) {
    finalBuffer[i] = Math.round(Math.max(0, Math.min(255, runningAverage[i])));
  }
  return new ImageData(finalBuffer, width, height);
}

/**
 * Averages multiple video frames into a single ImageData
 */
async function averageFrames(
  reader: ReadableStreamDefaultReader<VideoFrame>,
  frameCount: number,
  width: number,
  height: number
): Promise<ImageData | null> {
  const offscreen = new OffscreenCanvas(width, height);
  const ctx = offscreen.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Could not get OffscreenCanvas 2D context');

  let count = 0;
  let runningAverage: Float32Array | null = null;

  while (count < frameCount) {
    const { value: frame, done } = await reader.read();
    if (done || !frame) break;

    const imageData = await frameToImageData(frame, width, height, ctx);
    const result = accumulatePixelData(imageData, runningAverage, count);
    runningAverage = result.average;
    count = result.newCount;
  }
  if (!runningAverage) return null;
  return convertToImageData(runningAverage, width, height);
}

function simplifyMarkerResults(markers: any[]): { id: number; origin: { x: number; y: number } }[] {
  return markers.map(m => ({ id: m.id, origin: { x: m.origin.x, y: m.origin.y } }));
}

class MarkerScannerWorker implements MarkerScannerWorkerAPI {
  private reader: ReadableStreamDefaultReader<VideoFrame> | null = null;
  private mapX: Float32Array | null = null;
  private mapY: Float32Array | null = null;
  private averageFrames = 0;
  private width = 0;
  private height = 0;

  async init(reader: ReadableStream<VideoFrame>, calibrationData: CalibrationData, resolution: [number, number], averageFrames: number) {
    await ensureOpenCvIsLoaded();

    this.width = resolution[0];
    this.height = resolution[1];
    this.averageFrames = averageFrames;

    const [map1, map2] = calculateUndistortionMapsCached(calibrationData, this.width, this.height);
    this.mapX = map1;
    this.mapY = map2;

    this.reader = reader.getReader();
  }

  async scan(): Promise<{ id: number; origin: { x: number; y: number } }[]> {
    console.debug('scanning markers in worker');

    if (!this.reader || !this.mapX || !this.mapY) {
      throw new Error('Worker not initialized');
    }

    // Average frames
    const averageImage = await averageFrames(this.reader, this.averageFrames, this.width, this.height);
    if (!averageImage) return [];
    // Apply undistortion
    const undistortedMat = remapCv(averageImage, this.mapX, this.mapY);

    // Detect markers
    const markers = detectAruco(undistortedMat);
    undistortedMat.delete();

    // Return simplified results
    return simplifyMarkerResults(markers);
  }
}

const worker = new MarkerScannerWorker();
Comlink.expose(worker);

(self as any).onerror = (e: ErrorEvent) => console.error('[MarkerScannerWorker] uncaught:', e);
