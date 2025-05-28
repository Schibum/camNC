import { cv2, ensureOpenCvIsLoaded } from "@wbcnc/load-opencv";

import * as Comlink from "comlink";
import { convertCorners } from "../lib/calibrationCore";
import { PoseUniquenessGate } from "./poseUniquenessGate";
import { CornerFinderWorkerInput, CornerFinderWorkerOutput } from "./types";

const FRAME_BLUR_THRESH = 400;
const BOARD_BLUR_THRESH = 100;

export class CornerFinderWorker {
  private isOpencvInitialized = false;
  private isProcessing = false;

  private criteria: any;
  private winSize: any;
  private zeroZone: any;

  private srcMat: cv2.Mat | null = null;
  private grayMat: cv2.Mat | null = null;
  private cornersMatFull: cv2.Mat | null = null;
  private patternSizeCv: cv2.Size | null = null;
  private poseGate: PoseUniquenessGate | null = null;

  // FPS tracking
  private lastFrameTime: number = 0;
  private currentFps: number = 0;

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
    // console.log(`bbox: ${bbox.x}, ${bbox.y}, ${bbox.width}, ${bbox.height}`);
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

  async init(): Promise<boolean> {
    if (this.isOpencvInitialized) return true;
    await ensureOpenCvIsLoaded();
    this.criteria = new cv2.TermCriteria(
      (cv2 as any).TERM_CRITERIA_EPS + (cv2 as any).TERM_CRITERIA_MAX_ITER,
      30,
      0.001
    );
    this.zeroZone = new cv2.Size(-1, -1);
    this.winSize = new cv2.Size(11, 11);
    this.isOpencvInitialized = true;
    return true;
  }

  async processFrame(
    input: CornerFinderWorkerInput
  ): Promise<CornerFinderWorkerOutput> {
    if (!this.isOpencvInitialized) await this.init();
    if (this.isProcessing) throw new Error("Worker is busy.");
    this.isProcessing = true;

    const t0 = performance.now();

    // Calculate FPS at the start of frame processing
    if (this.lastFrameTime > 0) {
      const deltaTime = t0 - this.lastFrameTime;
      this.currentFps = deltaTime > 0 ? 1000 / deltaTime : 0;
    }
    this.lastFrameTime = t0;

    const { imageData, width, height, patternWidth, patternHeight } = input;

    try {
      if (!this.srcMat) {
        this.srcMat = new cv2.Mat(height, width, cv2.CV_8UC4);
        this.grayMat = new cv2.Mat(height, width, cv2.CV_8UC1);
      }
      if (!this.patternSizeCv) {
        this.patternSizeCv = new cv2.Size(patternWidth, patternHeight);
        const count = patternWidth * patternHeight;
        this.cornersMatFull?.delete();
        this.cornersMatFull = new cv2.Mat(count, 1, cv2.CV_32FC2);
      }

      if (this.srcMat!.rows !== height || this.srcMat!.cols !== width) {
        throw new Error("Frame size mismatch");
      }
      this.srcMat!.data.set(new Uint8ClampedArray(imageData));
      cv2.cvtColor(this.srcMat!, this.grayMat!, cv2.COLOR_RGBA2GRAY);

      // if (this._isBlurryFrame(this.grayMat!)) {
      //   console.info("[CFW] frame blurry → skip");
      //   return { corners: null };
      // }

      // Always use SB finder without downscaling
      const cornersPreview = new cv2.Mat();
      const found = cv2.findChessboardCornersSB(
        this.grayMat!,
        this.patternSizeCv!,
        cornersPreview,
        0
      );
      if (!found) {
        cornersPreview.delete();
        return {
          corners: null,
          isBlurry: false,
          isUnique: false,
          fps: this.currentFps,
        };
      }
      if (this._isChessboardBlurry(this.grayMat!, cornersPreview)) {
        cornersPreview.delete();
        return {
          corners: null,
          isBlurry: true,
          isUnique: false,
          fps: this.currentFps,
        };
      }

      for (let i = 0; i < cornersPreview.rows; ++i) {
        this.cornersMatFull!.data32F[2 * i]! = cornersPreview.data32F[2 * i]!;
        this.cornersMatFull!.data32F[2 * i + 1]! =
          cornersPreview.data32F[2 * i + 1]!;
      }
      cv2.cornerSubPix(
        this.grayMat!,
        this.cornersMatFull!,
        this.winSize,
        this.zeroZone,
        this.criteria
      );
      // TODO: run this before upscaling?

      if (!this.poseGate) {
        this.poseGate = new PoseUniquenessGate(
          { width: patternWidth, height: patternHeight },
          1.0
        );
      }
      const isUnique = this.poseGate.acceptDirect(
        this.cornersMatFull!,
        width,
        height
      );
      const corners = convertCorners(this.cornersMatFull);
      cornersPreview.delete();
      return { corners, isBlurry: false, isUnique, fps: this.currentFps };
    } finally {
      this.isProcessing = false;
      // console.log(`[CFW] ${(performance.now() - t0).toFixed(2)} ms`);
    }
  }
}

const worker = new CornerFinderWorker();
Comlink.expose(worker);

(self as any).onerror = (e: ErrorEvent) =>
  console.error("[CornerFinderWorker] uncaught:", e);
