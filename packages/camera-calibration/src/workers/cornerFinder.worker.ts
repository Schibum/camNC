import { cv2, ensureOpenCvIsLoaded } from "@wbcnc/load-opencv";
import * as Comlink from "comlink";
import { convertCorners } from "../lib/calibrationCore";
import type {
  CornerFinderWorkerInput,
  CornerFinderWorkerOutput,
} from "./types";

let cv: any;

const kUseClassic = true;
const PREVIEW_MAX_SIDE = Infinity; // 1600;
const FRAME_BLUR_THRESH = 400;
const BOARD_BLUR_THRESH = 400;

class CornerFinderWorker {
  private isOpencvInitialized = false;
  private isProcessing = false;

  private criteria: any;
  private winSize: any;
  private zeroZone: any;

  private srcMat: cv2.Mat | null = null;
  private grayMat: cv2.Mat | null = null;
  private cornersMatFull: cv2.Mat | null = null;
  private patternSizeCv: cv2.Size | null = null;

  private _lapVariance(mat: cv2.Mat, mask?: cv2.Mat): number {
    const lap = new cv.Mat();
    cv.Laplacian(mat, lap, cv.CV_64F);

    const mean = new cv.Mat();
    const std = new cv.Mat();
    if (mask) {
      cv.meanStdDev(lap, mean, std, mask);
    } else {
      cv.meanStdDev(lap, mean, std);
    }
    const varLap = std.data64F[0] ** 2;
    lap.delete();
    mean.delete();
    std.delete();
    return varLap;
  }

  private _isBlurryFrame(gray: cv2.Mat): boolean {
    let work = gray;
    if (Math.max(gray.rows, gray.cols) > 640) {
      const scale = 640 / Math.max(gray.rows, gray.cols);
      work = new cv.Mat();
      cv.resize(gray, work, new cv.Size(0, 0), scale, scale, cv.INTER_AREA);
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
    const pts = new cv.Mat();
    cornersPreview.convertTo(pts, cv.CV_32SC2);
    const hull = new cv.Mat();
    cv.convexHull(pts, hull, false, true);
    pts.delete();

    if (hull.rows < 3) {
      hull.delete();
      return true;
    }

    const bbox = cv.boundingRect(hull);
    console.log(`bbox: ${bbox.x}, ${bbox.y}, ${bbox.width}, ${bbox.height}`);
    const roiGray = grayPreview.roi(bbox);
    const roiMask = new cv.Mat.zeros(bbox.height, bbox.width, cv.CV_8UC1);
    const shiftedHull = new cv.Mat();
    hull.convertTo(shiftedHull, cv.CV_32S);

    for (let i = 0; i < shiftedHull.rows; i++) {
      shiftedHull.data32S[2 * i] -= bbox.x;
      shiftedHull.data32S[2 * i + 1] -= bbox.y;
    }
    cv.fillConvexPoly(roiMask, shiftedHull, new cv.Scalar(255));

    const varLap = this._lapVariance(roiGray, roiMask);
    const area = cv.countNonZero(roiMask);

    roiGray.delete();
    roiMask.delete();
    shiftedHull.delete();
    hull.delete();

    if (area < 50) return true;
    // console.log(`blur in chessboard: ${varLap}`);

    return varLap < BOARD_BLUR_THRESH;
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

  async processFrame(
    input: CornerFinderWorkerInput
  ): Promise<CornerFinderWorkerOutput> {
    if (!this.isOpencvInitialized) await this.init();
    if (this.isProcessing) throw new Error("Worker is busy.");
    this.isProcessing = true;

    const t0 = performance.now();
    const { imageData, width, height, patternWidth, patternHeight } = input;

    try {
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

      this.srcMat!.data.set(new Uint8ClampedArray(imageData));
      cv.cvtColor(this.srcMat!, this.grayMat!, cv.COLOR_RGBA2GRAY);

      // if (this._isBlurryFrame(this.grayMat!)) {
      //   console.info("[CFW] frame blurry → skip");
      //   return { corners: null };
      // }

      let grayPreview: cv2.Mat = this.grayMat!;
      let scale = 1.0;
      let needDeletePreview = false;
      if (Math.max(width, height) > PREVIEW_MAX_SIDE) {
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

      // if (this._isChessboardBlurry(grayPreview, cornersPreview)) {
      //   console.info("[CFW] chessboard blurry → skip");
      //   if (needDeletePreview) grayPreview.delete();
      //   cornersPreview.delete();
      //   return { corners: null };
      // }

      for (let i = 0; i < cornersPreview.rows; ++i) {
        this.cornersMatFull!.data32F[2 * i] =
          cornersPreview.data32F[2 * i] / scale;
        this.cornersMatFull!.data32F[2 * i + 1] =
          cornersPreview.data32F[2 * i + 1] / scale;
      }

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
      // console.log(`[CFW] ${(performance.now() - t0).toFixed(2)} ms`);
    }
  }
}

const worker = new CornerFinderWorker();
Comlink.expose(worker);

(self as any).onerror = (e: ErrorEvent) =>
  console.error("[CornerFinderWorker] uncaught:", e);
