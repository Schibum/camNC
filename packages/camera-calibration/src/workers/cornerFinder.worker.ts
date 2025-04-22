import * as Comlink from "comlink";
import { convertCorners } from "../lib/calibrationCore";
import type {
  CornerFinderWorkerInput,
  CornerFinderWorkerOutput,
} from "./types";

let cv: any;

class CornerFinderWorker {
  private isOpencvInitialized: boolean = false;
  private isProcessing: boolean = false;
  private criteria: any;
  private winSize: any;
  private zeroZone: any;

  constructor() {
    // No initialization in constructor
  }

  async init(): Promise<boolean> {
    console.log("[CornerFinderWorker] Initializing...");
    if (this.isOpencvInitialized) {
      return true;
    }

    const loaded = await this.loadOpenCV();
    if (!loaded) {
      console.error("[CornerFinderWorker] Failed to load OpenCV.");
      return false;
    }
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

  private async loadOpenCV(): Promise<boolean> {
    cv = await (
      await import(/* @vite-ignore */ location.origin + "/opencv_js.js")
    ).default();
    return true;
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

    this.isProcessing = true;

    const { messageId, imageData, width, height, patternWidth, patternHeight } =
      input;
    const imgData = new ImageData(
      new Uint8ClampedArray(imageData),
      width,
      height
    );

    let srcMat: any = null;
    let grayMat: any = null;
    let cornersMat: any = null;

    try {
      // Create source Mat from RGBA image data
      srcMat = cv.matFromImageData(imgData);
      // srcMat= cv.matFromArray(height, width, cv.CV_8UC4, imageData);
      if (!srcMat || srcMat.empty()) {
        throw new Error("Failed to create source Mat from image data.");
      }

      // Create grayscale Mat
      grayMat = new cv.Mat();

      // Convert to grayscale
      cv.cvtColor(srcMat, grayMat, cv.COLOR_RGBA2GRAY);

      // Define pattern size
      const patternSizeCv = new cv.Size(patternWidth, patternHeight);

      // Allocate corners Mat
      cornersMat = new cv.Mat();

      // Find chessboard corners
      const found = cv.findChessboardCorners(
        grayMat,
        patternSizeCv,
        cornersMat,
        cv.CALIB_CB_ADAPTIVE_THRESH +
          cv.CALIB_CB_NORMALIZE_IMAGE +
          cv.CALIB_CB_FAST_CHECK
      );

      // If corners are found, refine them with cornerSubPix for better accuracy
      if (found) {
        // Refine corner locations with subpixel accuracy
        cv.cornerSubPix(
          grayMat,
          cornersMat,
          this.winSize,
          this.zeroZone,
          this.criteria
        );

        // Get corner data as Float32Array
        const corners = convertCorners(cornersMat);
        return { type: "cornersFound", messageId, corners };
      } else {
        return { type: "cornersFound", messageId, corners: null };
      }
    } finally {
      // Clean up OpenCV Mats
      if (srcMat) srcMat.delete();
      if (grayMat) grayMat.delete();
      if (cornersMat) cornersMat.delete();

      this.isProcessing = false;
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
