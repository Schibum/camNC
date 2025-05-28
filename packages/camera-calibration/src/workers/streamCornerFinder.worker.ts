import { cv2, ensureOpenCvIsLoaded } from "@wbcnc/load-opencv";
import * as Comlink from "comlink";
import { convertCorners } from "../lib/calibrationCore";
import { Corner } from "../lib/calibrationTypes";
import { PoseUniquenessGate } from "./poseUniquenessGate";

const FRAME_BLUR_THRESH = 400;
const BOARD_BLUR_THRESH = 100;

/**
 * Event data emitted when corners are detected
 */
export interface CornerDetectedEvent {
  corners: Corner[];
  imageData: ImageData;
  isUnique: boolean;
  fps: number;
}

/**
 * Event data emitted when corners are cleared (not found or blurry)
 */
export interface CornerClearedEvent {
  isBlurry: boolean;
  fps: number;
}

/**
 * Worker API exposed via Comlink for stream-based corner detection
 */
export interface StreamCornerFinderWorkerAPI {
  init(
    stream: ReadableStream<VideoFrame>,
    patternSize: { width: number; height: number },
    frameSize: { width: number; height: number },
    onCornersDetected: (data: CornerDetectedEvent) => void,
    onCornersCleared: (data: CornerClearedEvent) => void
  ): Promise<void>;

  start(): Promise<void>;
  stop(): Promise<void>;
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

export class StreamCornerFinderWorker implements StreamCornerFinderWorkerAPI {
  private reader: ReadableStreamDefaultReader<VideoFrame> | null = null;
  private isProcessing = false;
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
  private onCornersDetected?: (data: CornerDetectedEvent) => void;
  private onCornersCleared?: (data: CornerClearedEvent) => void;

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

  private _isBlurryFrame(gray: cv2.Mat): boolean {
    let work = gray;
    if (Math.max(gray.rows, gray.cols) > 640) {
      const scale = 640 / Math.max(gray.rows, gray.cols);
      work = new cv2.Mat();
      cv2.resize(gray, work, new cv2.Size(0, 0), scale, scale, cv2.INTER_AREA);
    }
    const varLap = this._lapVariance(work);
    const blurry = varLap < FRAME_BLUR_THRESH;

    console.log(`blur in frame: ${varLap}`);
    if (work !== gray) work.delete();
    return blurry;
  }

  private _isChessboardBlurry(
    grayPreview: cv2.Mat,
    cornersPreview: cv2.Mat
  ): boolean {
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

    console.log(`blur in chessboard: ${varLap}`);

    return varLap < BOARD_BLUR_THRESH;
  }

  async init(
    stream: ReadableStream<VideoFrame>,
    patternSize: { width: number; height: number },
    frameSize: { width: number; height: number },
    onCornersDetected: (data: CornerDetectedEvent) => void,
    onCornersCleared: (data: CornerClearedEvent) => void
  ): Promise<void> {
    if (this.isInitialized) {
      throw new Error("Worker already initialized");
    }

    // Initialize OpenCV
    await ensureOpenCvIsLoaded();

    this.criteria = new cv2.TermCriteria(
      (cv2 as any).TERM_CRITERIA_EPS + (cv2 as any).TERM_CRITERIA_MAX_ITER,
      30,
      0.001
    );
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
    this.offscreenCanvas = new OffscreenCanvas(
      this.frameWidth,
      this.frameHeight
    );
    this.ctx = this.offscreenCanvas.getContext("2d", {
      willReadFrequently: true,
    });
    if (!this.ctx) {
      throw new Error("Could not get OffscreenCanvas 2D context");
    }

    // Set up stream reader
    this.reader = stream.getReader();

    this.isInitialized = true;
    console.log("[StreamCornerFinderWorker] Initialized successfully");

    this.onCornersDetected = onCornersDetected;
    this.onCornersCleared = onCornersCleared;
  }

  async start(): Promise<void> {
    if (!this.isInitialized || !this.reader) {
      throw new Error("Worker not initialized");
    }

    if (this.isProcessing) {
      console.warn(
        "[StreamCornerFinderWorker] Already processing, ignoring start request"
      );
      return;
    }

    this.isProcessing = true;
    console.log("[StreamCornerFinderWorker] Starting processing loop");

    // Start the processing loop
    this.processFrameLoop().catch((error) => {
      console.error("[StreamCornerFinderWorker] Processing loop error:", error);
      this.isProcessing = false;
    });
  }

  async stop(): Promise<void> {
    console.log("[StreamCornerFinderWorker] Stopping processing loop");
    this.isProcessing = false;
  }

  private async processFrameLoop(): Promise<void> {
    while (this.isProcessing && this.reader) {
      try {
        const { value: frame, done } = await this.reader.read();
        if (done || !frame) {
          console.log("[StreamCornerFinderWorker] Stream ended");
          break;
        }

        await this.processFrame(frame);
      } catch (error) {
        console.error(
          "[StreamCornerFinderWorker] Error in processing loop:",
          error
        );
        // Continue processing on errors to maintain robustness
      }
    }

    console.log("[StreamCornerFinderWorker] Processing loop ended");
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

    if (
      !this.ctx ||
      !this.srcMat ||
      !this.grayMat ||
      !this.cornersMatFull ||
      !this.patternSizeCv ||
      !this.poseGate
    ) {
      frame.close();
      return;
    }

    try {
      // Convert VideoFrame to ImageData
      const imageData = await frameToImageData(
        frame,
        this.frameWidth,
        this.frameHeight,
        this.ctx
      );

      // Set up OpenCV matrices
      this.srcMat.data.set(new Uint8ClampedArray(imageData.data));
      cv2.cvtColor(this.srcMat, this.grayMat, cv2.COLOR_RGBA2GRAY);

      // Find chessboard corners
      const cornersPreview = new cv2.Mat();
      const found = cv2.findChessboardCornersSB(
        this.grayMat,
        this.patternSizeCv,
        cornersPreview,
        0
      );

      if (!found) {
        cornersPreview.delete();
        this.onCornersCleared?.({
          isBlurry: false,
          fps: this.currentFps,
        });
        return;
      }

      // Check if chessboard is blurry
      if (this._isChessboardBlurry(this.grayMat, cornersPreview)) {
        cornersPreview.delete();
        this.onCornersCleared?.({
          isBlurry: true,
          fps: this.currentFps,
        });
        return;
      }

      // Refine corners
      for (let i = 0; i < cornersPreview.rows; ++i) {
        this.cornersMatFull.data32F[2 * i]! = cornersPreview.data32F[2 * i]!;
        this.cornersMatFull.data32F[2 * i + 1]! =
          cornersPreview.data32F[2 * i + 1]!;
      }

      cv2.cornerSubPix(
        this.grayMat,
        this.cornersMatFull,
        this.winSize,
        this.zeroZone,
        this.criteria
      );

      // Check uniqueness
      const isUnique = this.poseGate.acceptDirect(
        this.cornersMatFull,
        this.frameWidth,
        this.frameHeight
      );

      // Convert corners and emit event
      const corners = convertCorners(this.cornersMatFull);

      cornersPreview.delete();

      this.onCornersDetected?.({
        corners,
        imageData,
        isUnique,
        fps: this.currentFps,
      });
    } catch (error) {
      console.error(
        "[StreamCornerFinderWorker] Error processing frame:",
        error
      );
      this.onCornersCleared?.({
        isBlurry: false,
        fps: this.currentFps,
      });
    }
  }
}

const worker = new StreamCornerFinderWorker();
Comlink.expose(worker);

(self as any).onerror = (e: ErrorEvent) =>
  console.error("[StreamCornerFinderWorker] uncaught:", e);
