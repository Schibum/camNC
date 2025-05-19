import { cv2, ensureOpenCvIsLoaded } from "@wbcnc/load-opencv";
import * as Comlink from "comlink";
import { convertCorners } from "../lib/calibrationCore";
import type {
  CornerFinderWorkerInput,
  CornerFinderWorkerOutput,
} from "./types";

let cv: any;
// Use classic findChessboardCorners (true) or findChessboardCornersSB (false)
const kUseClassic = false;

class CornerFinderWorker {
  private isOpencvInitialized: boolean = false;
  private isProcessing: boolean = false;
  private criteria: any;
  private winSize: any;
  private zeroZone: any;
  private srcMat: cv2.Mat | null = null;
  private grayMat: cv2.Mat | null = null;
  private cornersMat: cv2.Mat | null = null;
  private patternSizeCv: cv2.Size | null = null;

  constructor() {
    // No initialization in constructor
  }

  private _isBlurry(gray: any, maxSide = 640): boolean {
    let work = gray;
    if (maxSide > 0 && Math.max(gray.rows, gray.cols) > maxSide) {
      const scale = maxSide / Math.max(gray.rows, gray.cols);
      work = new cv.Mat();
      cv.resize(
        gray,
        work,
        new cv.Size(0, 0), // let OpenCV compute the new size
        scale,
        scale,
        cv.INTER_AREA // best kernel when shrinking
      );
    }

    const lap = new cv2.Mat();
    cv2.Laplacian(work, lap, cv2.CV_64F);

    const mean = new cv.Mat();
    const std = new cv.Mat();
    cv.meanStdDev(lap, mean, std); // stdDev[0]² == variance
    const score = std.data64F[0] ** 2;
    console.log("[CornerFinderWorker] Blurriness score:", score);
    lap.delete();
    mean.delete();
    std.delete();

    return score < 200;
  }

  async init(): Promise<boolean> {
    console.log("[CornerFinderWorker] Initializing...");
    if (this.isOpencvInitialized) {
      return true;
    }

    await this.loadOpenCV();
    this.isOpencvInitialized = true;
    this.criteria = new cv.TermCriteria(
      cv.TERM_CRITERIA_EPS + cv.TERM_CRITERIA_MAX_ITER,
      30,
      0.001
    );

    // Create a zero-size zone for cornerSubPix
    this.zeroZone = new cv.Size(-1, -1);

    // Define window size for cornerSubPix
    this.winSize = new cv.Size(11, 11);
    return true;
  }

  private async loadOpenCV(): Promise<void> {
    await ensureOpenCvIsLoaded();
    cv = self.cv;
  }

  async processFrame(
    input: CornerFinderWorkerInput
  ): Promise<CornerFinderWorkerOutput> {
    if (!this.isOpencvInitialized) {
      const initialized = await this.init();
      if (!initialized) {
        throw new Error("OpenCV failed to load in worker.");
      }
    }

    if (this.isProcessing) {
      console.warn("[CornerFinderWorker] Already processing, skipping frame.");
      throw new Error("Worker is busy.");
    }

    const startAt = performance.now();

    this.isProcessing = true;

    const { imageData, width, height, patternWidth, patternHeight } = input;

    try {
      if (!this.srcMat) {
        this.srcMat = new cv.Mat(height, width, cv.CV_8UC4);
        this.grayMat = new cv.Mat(height, width, cv.CV_8UC1);
      }

      // Copy new RGBA pixels into the existing Mat buffer
      const rgba = new Uint8ClampedArray(imageData);
      this.srcMat!.data.set(rgba);

      if (!this.patternSizeCv) {
        this.cornersMat?.delete();
        this.patternSizeCv = new cv.Size(patternWidth, patternHeight);
        const count = patternWidth * patternHeight;
        // two‐channel float for (x,y)
        this.cornersMat = new cv.Mat(count, 1, cv.CV_32FC2);
      }

      // Now convert & detect in-place:
      cv.cvtColor(this.srcMat, this.grayMat, cv.COLOR_RGBA2GRAY);

      if (this._isBlurry(this.grayMat)) {
        console.warn(
          "[CornerFinderWorker] Image is too blurry, skipping frame."
        );
        return { corners: null };
      }

      let found = false;
      if (kUseClassic) {
        // Find chessboard corners
        found = cv.findChessboardCorners(
          this.grayMat,
          this.patternSizeCv,
          this.cornersMat,
          cv.CALIB_CB_ADAPTIVE_THRESH +
            cv.CALIB_CB_NORMALIZE_IMAGE +
            cv.CALIB_CB_FAST_CHECK
        );
      } else {
        found = cv.findChessboardCornersSB(
          this.grayMat,
          this.patternSizeCv,
          this.cornersMat,
          0
        );
      }

      // If corners are found, refine them with cornerSubPix for better accuracy
      if (found) {
        // Refine corner locations with subpixel accuracy
        if (kUseClassic) {
          cv.cornerSubPix(
            this.grayMat,
            this.cornersMat,
            this.winSize,
            this.zeroZone,
            this.criteria
          );
        }

        // Get corner data as Float32Array
        const corners = convertCorners(this.cornersMat);
        return { corners };
      } else {
        return { corners: null };
      }
    } finally {
      this.isProcessing = false;
      const endAt = performance.now();
      console.log(
        `[CornerFinderWorker] Processed frame in ${endAt - startAt}ms`
      );
    }
  }
}

// Create an instance of the worker
const worker = new CornerFinderWorker();

// Expose the worker instance to the main thread using Comlink
Comlink.expose(worker);

// Handle errors
self.onerror = (error) => {
  console.error("[CornerFinderWorker] Uncaught worker error:", error);
};
