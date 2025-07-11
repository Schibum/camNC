import { ensureOpenCvIsLoaded } from '@wbcnc/load-opencv';
import { ensureReadableStream, registerThreeJsTransferHandlers } from '@wbcnc/video-worker-utils';
import * as Comlink from 'comlink';
import { calculateUndistortionMapsCached } from '../calibration/rectifyMap';
import { remapCv } from '../calibration/remapCv';
import { detectAruco, IMarker } from '../setup/detect-aruco';
import type { CalibrationData } from '../store/store';

registerThreeJsTransferHandlers();

/**
 * Worker API exposed via Comlink.
 */
export interface MarkerScannerWorkerAPI {
  init(
    stream: ReadableStream<VideoFrame> | MediaStreamTrack,
    calibrationData: CalibrationData,
    resolution: [number, number]
  ): Promise<void>;
  replaceStream(stream: ReadableStream<VideoFrame> | MediaStreamTrack): Promise<void>;
  scan(): Promise<IMarker[]>;
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

/*
function simplifyMarkerResults(markers: any[]): { id: number; origin: { x: number; y: number } }[] {
  return markers.map((m) => ({ id: m.id, origin: { x: m.origin.x, y: m.origin.y } }));
}
*/

class MarkerScannerWorker implements MarkerScannerWorkerAPI {
  private reader: ReadableStreamDefaultReader<VideoFrame> | null = null;
  private mapX: Float32Array | null = null;
  private mapY: Float32Array | null = null;
  private width = 0;
  private height = 0;
  private ctx: OffscreenCanvasRenderingContext2D | null = null;

  async init(stream: ReadableStream<VideoFrame> | MediaStreamTrack, calibrationData: CalibrationData, resolution: [number, number]) {
    await ensureOpenCvIsLoaded();

    this.width = resolution[0];
    this.height = resolution[1];

    const offscreen = new OffscreenCanvas(this.width, this.height);
    const ctx = offscreen.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('Could not get OffscreenCanvas 2D context');
    this.ctx = ctx;

    const [map1, map2] = calculateUndistortionMapsCached(calibrationData, this.width, this.height);
    this.mapX = map1;
    this.mapY = map2;

    this.reader = ensureReadableStream(stream).getReader();
  }

  async replaceStream(stream: ReadableStream<VideoFrame> | MediaStreamTrack): Promise<void> {
    if (this.reader) {
      try {
        await this.reader.cancel();
      } catch {
        /* ignore */
      }
    }
    this.reader = ensureReadableStream(stream).getReader();
  }

  async scan(): Promise<IMarker[]> {
    if (!this.reader || !this.mapX || !this.mapY || !this.ctx) {
      throw new Error('Worker not initialized');
    }

    const { value: frame, done } = await this.reader.read();
    if (done || !frame) return [];
    const imageData = await frameToImageData(frame, this.width, this.height, this.ctx);

    const undistortedMat = remapCv(imageData, [this.width, this.height], this.mapX, this.mapY);

    // Detect markers
    const markers = detectAruco(undistortedMat);
    undistortedMat.delete();

    // Return simplified results
    return markers;
  }
}

const worker = new MarkerScannerWorker();
Comlink.expose(worker);

(self as any).onerror = (e: ErrorEvent) => console.error('[MarkerScannerWorker] uncaught:', e);
