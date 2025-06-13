import { cv2, ensureOpenCvIsLoaded } from '@wbcnc/load-opencv';
import * as Comlink from 'comlink';
import { convertCorners } from '../lib/calibrationCore';
import { Corner } from '../lib/calibrationTypes';
import { ensureReadableStream } from '../utils/ensureReadableStream';
import { PoseUniquenessGate } from './poseUniquenessGate';

const BOARD_BLUR_THRESH = 80;

export interface FrameCaptureEvent {
  corners: Corner[];
  imageData: ImageData;
  fps: number;
  result: 'capture';
}

export interface FrameRejectedEvent {
  corners?: Corner[];
  result: 'blurry' | 'not_unique';
  fps: number;
}

export type FrameEvent = FrameCaptureEvent | FrameRejectedEvent;

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

export class StreamCornerFinderWorker {
  private reader: ReadableStreamDefaultReader<VideoFrame> | null = null;
  private isProcessing = false;
  private isPaused = false;
  private isInitialized = false;

  // OpenCV-related state
  private criteria: any;
  private winSize: any;
  private zeroZone: any;
  private srcMat: cv2.Mat | null = null;
  private grayMat: cv2.Mat | null = null;
  private cornersMatFull: cv2.Mat | null = null;
  private patternSizeCv: cv2.Size | null = null;
  private poseGate: PoseUniquenessGate | null = null;

  // Canvas for video frame processing
  private offscreenCanvas: OffscreenCanvas | null = null;
  private ctx: OffscreenCanvasRenderingContext2D | null = null;

  // Frame dimensions
  private frameWidth = 0;
  private frameHeight = 0;

  // FPS tracking
  private lastFrameTime: number = 0;
  private currentFps: number = 0;

  // Event handlers (set during init)
  private onFrameProcessed?: (data: FrameEvent) => void;

  private _lapVariance(mat: cv2.Mat, mask?: cv2.Mat): number {
    const lap = new cv2.Mat();
    cv2.Laplacian(mat, lap, cv2.CV_64F);

    const mean = new cv2.Mat();
    const std = new cv2.Mat();
    if (mask) {
      cv2.meanStdDev(lap, mean, std, mask);
    } else {
      cv2.meanStdDev(lap, mean, std);
    }
    const varLap = std.data64F[0]! ** 2;
    lap.delete();
    mean.delete();
    std.delete();
    return varLap;
  }

  private _isChessboardBlurry(grayPreview: cv2.Mat, cornersPreview: cv2.Mat): boolean {
    const pts = new cv2.Mat();
    cornersPreview.convertTo(pts, cv2.CV_32SC2);
    const hull = new cv2.Mat();
    cv2.convexHull(pts, hull, false, true);
    pts.delete();

    if (hull.rows < 3) {
      hull.delete();
      return true;
    }

    const bbox = cv2.boundingRect(hull);
    const roiGray = grayPreview.roi(bbox);
    const roiMask = cv2.Mat.zeros(bbox.height, bbox.width, cv2.CV_8UC1);
    const shiftedHull = new cv2.Mat();
    hull.convertTo(shiftedHull, cv2.CV_32S);

    for (let i = 0; i < shiftedHull.rows; i++) {
      shiftedHull.data32S[2 * i]! -= bbox.x;
      shiftedHull.data32S[2 * i + 1]! -= bbox.y;
    }
    cv2.fillConvexPoly(roiMask, shiftedHull, new cv2.Scalar(255));

    const varLap = this._lapVariance(roiGray, roiMask);

    roiGray.delete();
    roiMask.delete();
    shiftedHull.delete();
    hull.delete();

    // console.log(`blur in chessboard: ${varLap}`);

    return varLap < BOARD_BLUR_THRESH;
  }

  async init(
    stream: ReadableStream<VideoFrame> | MediaStreamTrack,
    patternSize: { width: number; height: number },
    frameSize: { width: number; height: number },
    onFrameProcessed: (data: FrameEvent) => void
  ): Promise<void> {
    if (this.isInitialized) {
      throw new Error('Worker already initialized');
    }

    // Initialize OpenCV
    await ensureOpenCvIsLoaded();

    this.criteria = new cv2.TermCriteria((cv2 as any).TERM_CRITERIA_EPS + (cv2 as any).TERM_CRITERIA_MAX_ITER, 30, 0.001);
    this.zeroZone = new cv2.Size(-1, -1);
    this.winSize = new cv2.Size(11, 11);

    // Set up frame dimensions and pattern
    this.frameWidth = frameSize.width;
    this.frameHeight = frameSize.height;

    // Initialize OpenCV matrices
    this.srcMat = new cv2.Mat(this.frameHeight, this.frameWidth, cv2.CV_8UC4);
    this.grayMat = new cv2.Mat(this.frameHeight, this.frameWidth, cv2.CV_8UC1);
    this.patternSizeCv = new cv2.Size(patternSize.width, patternSize.height);

    const count = patternSize.width * patternSize.height;
    this.cornersMatFull = new cv2.Mat(count, 1, cv2.CV_32FC2);

    // Initialize pose uniqueness gate
    this.poseGate = new PoseUniquenessGate(patternSize, 1.0);

    // Set up offscreen canvas for video frame processing
    this.offscreenCanvas = new OffscreenCanvas(this.frameWidth, this.frameHeight);
    this.ctx = this.offscreenCanvas.getContext('2d', {
      willReadFrequently: true,
    });
    if (!this.ctx) {
      throw new Error('Could not get OffscreenCanvas 2D context');
    }

    // Set up stream reader
    this.reader = ensureReadableStream(stream).getReader();

    this.isInitialized = true;
    console.log('[StreamCornerFinderWorker] Initialized successfully');

    this.onFrameProcessed = onFrameProcessed;
  }

  async start(): Promise<void> {
    if (!this.isInitialized || !this.reader) {
      throw new Error('Worker not initialized');
    }

    if (this.isProcessing) {
      console.warn('[StreamCornerFinderWorker] Already processing, ignoring start request');
      return;
    }

    this.isProcessing = true;
    this.isPaused = false;
    console.log('[StreamCornerFinderWorker] Starting processing loop');

    // Start the processing loop
    this.processFrameLoop().catch(error => {
      console.error('[StreamCornerFinderWorker] Processing loop error:', error);
      this.isProcessing = false;
    });
  }

  async stop(): Promise<void> {
    console.log('[StreamCornerFinderWorker] Stopping processing loop');
    this.isProcessing = false;
    this.isPaused = false;
  }

  async pause(): Promise<void> {
    console.log('[StreamCornerFinderWorker] Pausing processing');
    this.isPaused = true;
  }

  async resume(): Promise<void> {
    console.log('[StreamCornerFinderWorker] Resuming processing');
    this.isPaused = false;
  }

  private async processFrameLoop(): Promise<void> {
    while (this.isProcessing && this.reader) {
      try {
        // Skip processing if paused, but continue reading frames to avoid blocking the stream
        if (this.isPaused) {
          const { value: frame, done } = await this.reader.read();
          if (done || !frame) {
            console.log('[StreamCornerFinderWorker] Stream ended');
            break;
          }
          // Close the frame without processing to free resources
          frame.close();
          continue;
        }

        const { value: frame, done } = await this.reader.read();
        if (done || !frame) {
          console.log('[StreamCornerFinderWorker] Stream ended');
          break;
        }

        await this.processFrame(frame);
      } catch (error) {
        console.error('[StreamCornerFinderWorker] Error in processing loop:', error);
        // Continue processing on errors to maintain robustness
      }
    }

    console.log('[StreamCornerFinderWorker] Processing loop ended');
    this.isProcessing = false;
  }

  private async processFrame(frame: VideoFrame): Promise<void> {
    const t0 = performance.now();

    // Calculate FPS
    if (this.lastFrameTime > 0) {
      const deltaTime = t0 - this.lastFrameTime;
      this.currentFps = deltaTime > 0 ? 1000 / deltaTime : 0;
    }
    this.lastFrameTime = t0;

    if (!this.ctx || !this.srcMat || !this.grayMat || !this.cornersMatFull || !this.patternSizeCv || !this.poseGate) {
      frame.close();
      return;
    }

    try {
      // Convert VideoFrame to ImageData
      const imageData = await frameToImageData(frame, this.frameWidth, this.frameHeight, this.ctx);

      // Set up OpenCV matrices
      this.srcMat.data.set(new Uint8ClampedArray(imageData.data));
      cv2.cvtColor(this.srcMat, this.grayMat, cv2.COLOR_RGBA2GRAY);

      // Find chessboard corners
      const found = cv2.findChessboardCornersSB(this.grayMat, this.patternSizeCv, this.cornersMatFull, 0);

      if (!found) {
        this.onFrameProcessed!({
          result: 'not_unique',
          fps: this.currentFps,
        });
        return;
      }

      const corners = convertCorners(this.cornersMatFull);

      // Check if chessboard is blurry
      if (this._isChessboardBlurry(this.grayMat, this.cornersMatFull)) {
        this.onFrameProcessed!({
          corners,
          result: 'blurry',
          fps: this.currentFps,
        });
        return;
      }

      // Check uniqueness
      const isUnique = this.poseGate.isUnique(this.cornersMatFull, this.frameWidth, this.frameHeight);

      if (!isUnique) {
        this.onFrameProcessed!({
          corners,
          result: 'not_unique',
          fps: this.currentFps,
        });
        return;
      }

      this.onFrameProcessed!({
        result: 'capture',
        corners,
        imageData,
        fps: this.currentFps,
      });
    } catch (error) {
      console.error('[StreamCornerFinderWorker] Error processing frame:', error);
    }
  }

  /**
   * Replaces the currently-consumed VideoFrame stream with a new one.
   * It is totally fine if a few frames are missed during the switch.
   */
  async replaceStream(stream: ReadableStream<VideoFrame> | MediaStreamTrack): Promise<void> {
    if (!this.isInitialized) {
      throw new Error('Worker not initialized – cannot replace stream');
    }

    // Cancel the current reader so any pending read() promises reject.
    if (this.reader) {
      try {
        await this.reader.cancel();
      } catch {
        /* Ignore cancellation errors */
      }
    }

    // Swap to the new reader. The processing loop will continue; on the next
    // iteration it will pick up this.reader and read from the new track.
    this.reader = ensureReadableStream(stream).getReader();
    this.isProcessing = true;
    this.processFrameLoop().catch(error => {
      console.error('[StreamCornerFinderWorker] Processing loop error:', error);
      this.isProcessing = false;
    });

    console.log('[StreamCornerFinderWorker] Replaced video stream reader');
  }
}

const worker = new StreamCornerFinderWorker();
Comlink.expose(worker);

export type StreamCornerFinderWorkerAPI = typeof worker;

(self as any).onerror = (e: ErrorEvent) => console.error('[StreamCornerFinderWorker] uncaught:', e);
