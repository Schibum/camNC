import { cv2, ensureOpenCvIsLoaded } from "@wbcnc/load-opencv";
import * as Comlink from "comlink";
import { convertCorners } from "../lib/calibrationCore";
import type {
  CornerFinderWorkerInput,
  CornerFinderWorkerOutput,
} from "./types";

let cv: any;
const kUseClassic = false; // true -> findChessboardCorners; false -> findChessboardCornersSB
const PREVIEW_MAX_SIDE = 1600; // px, down‑scale for corner search

class CornerFinderWorker {
  private isOpencvInitialized = false;
  private isProcessing = false;

  private criteria: any;
  private winSize: any;
  private zeroZone: any;

  private srcMat: cv2.Mat | null = null; // RGBA full‑res
  private grayMat: cv2.Mat | null = null; // gray  full‑res
  private cornersMatFull: cv2.Mat | null = null;
  private patternSizeCv: cv2.Size | null = null;

  /*–––––––––––––––––––––––––––– Utility: Laplacian variance –––––––––––––*/
  private _lapVariance(mat: cv2.Mat): number {
    const lap = new cv.Mat();
    cv.Laplacian(mat, lap, cv.CV_64F);
    const mean = new cv.Mat();
    const std = new cv.Mat();
    cv.meanStdDev(lap, mean, std);
    const varLap = std.data64F[0] ** 2;
    lap.delete();
    mean.delete();
    std.delete();
    return varLap;
  }

  /* Fast pre‑gate on whole frame (optional) */
  private _isBlurryFrame(gray: cv2.Mat, maxSide = 640, thresh = 200): boolean {
    let work = gray;
    if (maxSide > 0 && Math.max(gray.rows, gray.cols) > maxSide) {
      const scale = maxSide / Math.max(gray.rows, gray.cols);
      work = new cv.Mat();
      cv.resize(gray, work, new cv.Size(0, 0), scale, scale, cv.INTER_AREA);
    }
    const blurry = this._lapVariance(work) < thresh;
    if (work !== gray) work.delete();
    return blurry;
  }

  /* NEW: test blur **inside the chessboard ROI** (preview coordinates) */
  private _isChessboardBlurry(
    grayPreview: cv2.Mat,
    cornersPreview: cv2.Mat,
    thresh = 200
  ): boolean {
    // 1. compute bounding box of detected corners
    let minX = Number.POSITIVE_INFINITY,
      minY = Number.POSITIVE_INFINITY,
      maxX = 0,
      maxY = 0;
    for (let i = 0; i < cornersPreview.rows; ++i) {
      const x = cornersPreview.data32F[2 * i];
      const y = cornersPreview.data32F[2 * i + 1];
      if (x! < minX) minX = x!;
      if (y! < minY) minY = y!;
      if (x! > maxX) maxX = x!;
      if (y! > maxY) maxY = y!;
    }

    // 2. add 10 % margin to catch slight motion blur outside
    const marginX = 0.1 * (maxX - minX);
    const marginY = 0.1 * (maxY - minY);
    const x0 = Math.max(Math.floor(minX - marginX), 0);
    const y0 = Math.max(Math.floor(minY - marginY), 0);
    const x1 = Math.min(Math.ceil(maxX + marginX), grayPreview.cols - 1);
    const y1 = Math.min(Math.ceil(maxY + marginY), grayPreview.rows - 1);
    const w = x1 - x0;
    const h = y1 - y0;
    if (w <= 0 || h <= 0) return true; // something went wrong – treat as blurry

    // 3. ROI and compute variance
    const roiRect = new cv.Rect(x0, y0, w, h);
    const roi = grayPreview.roi(roiRect);
    const varLap = this._lapVariance(roi);
    console.log(`blur in chessboard: ${varLap}`);
    roi.delete();

    return varLap < thresh;
  }

  /*–––––––––––––––––––––––––– OpenCV init –––––––––––––––––––––––––––––––*/
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

  /*–––––––––––––––––––––––––– main worker entry –––––––––––––––––––––––––*/
  async processFrame(
    input: CornerFinderWorkerInput
  ): Promise<CornerFinderWorkerOutput> {
    if (!this.isOpencvInitialized) await this.init();
    if (this.isProcessing) throw new Error("Worker is busy.");
    this.isProcessing = true;

    const t0 = performance.now();
    const { imageData, width, height, patternWidth, patternHeight } = input;

    try {
      /* allocate persistent full‑res Mats once */
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

      /* load RGBA buffer → srcMat */
      this.srcMat!.data.set(new Uint8ClampedArray(imageData));
      cv.cvtColor(this.srcMat, this.grayMat, cv.COLOR_RGBA2GRAY);

      /* optional whole‑frame blur gate (fast) */
      if (this._isBlurryFrame(this.grayMat!)) {
        console.info("[CFW] frame blurry → skip");
        return { corners: null };
      }

      /* build preview (might equal grayMat) */
      let grayPreview: cv2.Mat = this.grayMat!;
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

      /* detect chessboard in preview */
      const cornersPreview = new cv.Mat();
      let found = false;
      if (kUseClassic) {
        found = cv.findChessboardCorners(
          grayPreview,
          this.patternSizeCv,
          cornersPreview,
          cv.CALIB_CB_ADAPTIVE_THRESH |
            cv.CALIB_CB_NORMALIZE_IMAGE |
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

      if (this._isChessboardBlurry(grayPreview, cornersPreview)) {
        console.info("[CFW] chessboard blurry → skip");
        if (needDeletePreview) grayPreview.delete();
        cornersPreview.delete();
        return { corners: null };
      }

      /* upscale preview coordinates → full‑res Mat */
      for (let i = 0; i < cornersPreview.rows; ++i) {
        this.cornersMatFull!.data32F[2 * i] =
          cornersPreview.data32F[2 * i] / scale;
        this.cornersMatFull!.data32F[2 * i + 1] =
          cornersPreview.data32F[2 * i + 1] / scale;
      }

      /* sub‑pixel refinement (always native res) */
      cv.cornerSubPix(
        this.grayMat,
        this.cornersMatFull,
        this.winSize,
        this.zeroZone,
        this.criteria
      );

      const corners = convertCorners(this.cornersMatFull);

      if (needDeletePreview) grayPreview.delete();
      cornersPreview.delete();

      return { corners };
    } finally {
      this.isProcessing = false;
      console.log(`[CFW] ${(performance.now() - t0).toFixed(2)} ms`);
    }
  }
}

/*–––––––––––––––– Comlink plumbing –––––––––––––––––*/
const worker = new CornerFinderWorker();
Comlink.expose(worker);

(self as any).onerror = (e: ErrorEvent) =>
  console.error("[CornerFinderWorker] uncaught:", e);
