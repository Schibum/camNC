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

const PREVIEW_MAX_SIDE = 1600;

class CornerFinderWorker {
  private isOpencvInitialized = false;
  private isProcessing = false;

  private criteria: any;
  private winSize: any;
  private zeroZone: any;

  // Re-used Mats (full-resolution)
  private srcMat: cv2.Mat | null = null;
  private grayMat: cv2.Mat | null = null;
  private cornersMatFull: cv2.Mat | null = null;
  private patternSizeCv: cv2.Size | null = null;

  constructor() {}

  // ------------ quick blur gate (variance of Laplacian) ------------------
  private _isBlurry(gray: cv2.Mat, maxSide = 640): boolean {
    let work: cv2.Mat = gray;
    if (maxSide > 0 && Math.max(gray.rows, gray.cols) > maxSide) {
      const scale = maxSide / Math.max(gray.rows, gray.cols);
      work = new cv.Mat();
      cv.resize(gray, work, new cv.Size(0, 0), scale, scale, cv.INTER_AREA);
    }

    const lap = new cv.Mat();
    cv.Laplacian(work, lap, cv.CV_64F);

    const mean = new cv.Mat();
    const std = new cv.Mat();
    cv.meanStdDev(lap, mean, std);
    const score = std.data64F[0] ** 2;

    lap.delete();
    mean.delete();
    std.delete();
    if (work !== gray) work.delete();

    return score < 200; // tweak threshold for your camera / lighting
  }

  async init(): Promise<boolean> {
    if (this.isOpencvInitialized) return true;

    await ensureOpenCvIsLoaded();
    cv = (self as any).cv;

    this.criteria = new cv.TermCriteria(
      cv.TERM_CRITERIA_EPS + cv.TERM_CRITERIA_MAX_ITER,
      30,
      0.001
    );
    this.zeroZone = new cv.Size(-1, -1);
    this.winSize = new cv.Size(11, 11);

    this.isOpencvInitialized = true;
    return true;
  }

  // --------------------------- main entry --------------------------------
  async processFrame(
    input: CornerFinderWorkerInput
  ): Promise<CornerFinderWorkerOutput> {
    if (!this.isOpencvInitialized) await this.init();

    if (this.isProcessing) throw new Error("Worker is busy.");
    this.isProcessing = true;

    const startAt = performance.now();
    const { imageData, width, height, patternWidth, patternHeight } = input;

    try {
      /* 1. make sure reusable Mats exist (full-resolution) */
      if (!this.srcMat) {
        this.srcMat = new cv.Mat(height, width, cv.CV_8UC4);
        this.grayMat = new cv.Mat(height, width, cv.CV_8UC1);
      }
      if (!this.patternSizeCv) {
        this.patternSizeCv = new cv.Size(patternWidth, patternHeight);

        const count = patternWidth * patternHeight;
        this.cornersMatFull?.delete();
        this.cornersMatFull = new cv.Mat(count, 1, cv.CV_32FC2);
      }

      /* 2. load incoming RGBA buffer directly into srcMat */
      this.srcMat!.data.set(new Uint8ClampedArray(imageData));

      /* 3. convert to gray */
      cv.cvtColor(this.srcMat, this.grayMat, cv.COLOR_RGBA2GRAY);

      /* 4. fast blur gate on the gray-preview (internal down-scale) */
      if (this._isBlurry(this.grayMat!)) {
        console.warn("[CornerFinderWorker] Frame too blurry – skipped");
        return { corners: null };
      }

      /* 5. build (or re-use) a PREVIEW image for pattern search */
      let grayPreview: cv2.Mat = this.grayMat!; // may remain full-res
      let scale = 1.0;
      let needDeletePreview = false;

      if (PREVIEW_MAX_SIDE > 0 && Math.max(width, height) > PREVIEW_MAX_SIDE) {
        scale = PREVIEW_MAX_SIDE / Math.max(width, height);
        grayPreview = new cv.Mat();
        cv.resize(
          this.grayMat,
          grayPreview,
          new cv.Size(0, 0),
          scale,
          scale,
          cv.INTER_AREA
        );
        needDeletePreview = true;
      }

      /* 6. detect chessboard corners on the preview */
      const cornersPreview = new cv.Mat();
      let found = false;
      if (kUseClassic) {
        found = cv.findChessboardCorners(
          grayPreview,
          this.patternSizeCv,
          cornersPreview,
          cv.CALIB_CB_ADAPTIVE_THRESH +
            cv.CALIB_CB_NORMALIZE_IMAGE +
            cv.CALIB_CB_FAST_CHECK
        );
      } else {
        found = cv.findChessboardCornersSB(
          grayPreview,
          this.patternSizeCv,
          cornersPreview,
          0
        );
      }

      if (!found) {
        if (needDeletePreview) grayPreview.delete();
        cornersPreview.delete();
        return { corners: null };
      }

      /* 7. upscale coordinates → full-res Mat */
      for (let i = 0; i < cornersPreview.rows; ++i) {
        const x = cornersPreview.data32F[2 * i] / scale;
        const y = cornersPreview.data32F[2 * i + 1] / scale;
        this.cornersMatFull!.data32F[2 * i] = x;
        this.cornersMatFull!.data32F[2 * i + 1] = y;
      }

      /* 8. sub-pixel refinement at NATIVE resolution (always) */
      const subPixStart = performance.now();
      cv.cornerSubPix(
        this.grayMat,
        this.cornersMatFull,
        this.winSize,
        this.zeroZone,
        this.criteria
      );
      const subPixEnd = performance.now();
      // console.log(
      //   `[CornerFinderWorker] Sub-pixel refinement took ${(
      //     subPixEnd - subPixStart
      //   ).toFixed(2)} ms`
      // );

      /* 9. convert to Float32Array for posting back */
      const corners = convertCorners(this.cornersMatFull);

      /* 10. cleanup preview mats */
      if (needDeletePreview) grayPreview.delete();
      cornersPreview.delete();

      return { corners };
    } finally {
      this.isProcessing = false;
      console.log(
        `[CornerFinderWorker] frame processed in ${(
          performance.now() - startAt
        ).toFixed(2)} ms`
      );
    }
  }
}

/* ------------------ singleton + Comlink plumbing ------------------------ */
const worker = new CornerFinderWorker();
Comlink.expose(worker);

self.onerror = (err) =>
  console.error("[CornerFinderWorker] Uncaught worker error:", err);
