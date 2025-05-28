/* ------------------------------------------------------------------
   PoseUniquenessGate  –  keep only frames whose (R,t) differs enough
   ------------------------------------------------------------------ */
import { cv2 } from "@wbcnc/load-opencv";
import { createObjectPoints } from "../lib/calibrationCore";
import { PatternSize } from "../lib/calibrationTypes";

interface Pose {
  rvec: cv2.Mat;
  tvec: cv2.Mat;
}

export class PoseUniquenessGate {
  private readonly diag: number; // pattern diagonal (world u.)
  private readonly objPts: cv2.Mat; // cached 3-D board coords
  private poses: Pose[] = [];
  private K: cv2.Mat | null = null; // cached camera matrix
  private frameW = 0;
  private frameH = 0;

  constructor(
    readonly pattern: PatternSize,
    readonly squareSize = 1.0
  ) {
    this.diag = Math.hypot(pattern.width - 1, pattern.height - 1) * squareSize;
    this.objPts = createObjectPoints(pattern, squareSize); // keep forever
  }

  /** throw away all remembered poses (e.g. between sessions) */
  reset(): void {
    this.poses.forEach((p) => {
      p.rvec.delete();
      p.tvec.delete();
    });
    this.poses = [];
    this.K?.delete();
    this.K = null;
    this.frameW = 0;
    this.frameH = 0;
  }

  /** Clean up all OpenCV resources */
  destroy(): void {
    this.reset();
    this.objPts.delete();
  }

  /** Update camera matrix if frame dimensions change */
  private updateCameraMatrix(frameW: number, frameH: number): void {
    if (this.frameW !== frameW || this.frameH !== frameH) {
      this.K?.delete();
      const fGuess = Math.max(frameW, frameH);
      this.K = cv2.matFromArray(3, 3, cv2.CV_64F, [
        fGuess,
        0,
        frameW / 2,
        0,
        fGuess,
        frameH / 2,
        0,
        0,
        1,
      ]);
      this.frameW = frameW;
      this.frameH = frameH;
    }
  }

  // returns true  ⇢  frame is sufficiently different & stored
  //   false ⇢  too similar, ignore
  acceptDirect(
    cornersMat: cv2.Mat,
    frameW: number,
    frameH: number,
    thresh = 90,
    rotWeight = 3,
    traWeight = 1
  ): boolean {
    // Update camera matrix if frame dimensions changed
    this.updateCameraMatrix(frameW, frameH);

    const rvec = new cv2.Mat();
    const tvec = new cv2.Mat();
    cv2.solvePnP(
      this.objPts,
      cornersMat,
      this.K!,
      new cv2.Mat(),
      rvec,
      tvec,
      false,
      (cv2 as any).SOLVEPNP_SQPNP
    );

    // first ever pose → accept unconditionally
    if (this.poses.length === 0) {
      this.poses.push({ rvec, tvec });
      return true;
    }

    // 3. compare to every stored pose
    let minScore = Infinity;
    for (const p of this.poses) {
      const rotDeg = this._rotationDiffDeg(rvec, p.rvec); // °
      const traDeg = this._translationDeg(tvec, p.tvec); // °
      const score = rotWeight * rotDeg + traWeight * traDeg;
      minScore = Math.min(minScore, score);
    }
    // console.log(`[Pug] score: ${minScore}`);

    const unique = minScore > thresh;

    if (unique) {
      this.poses.push({ rvec, tvec }); // keep → memory ownership stays
    } else {
      // discard → free Mats now
      rvec.delete();
      tvec.delete();
    }
    return unique;
  }

  /* ---------- helpers ---------- */

  private _rotationDiffDeg(rv1: cv2.Mat, rv2: cv2.Mat): number {
    const R1 = new cv2.Mat(),
      R2 = new cv2.Mat(),
      R = new cv2.Mat();
    cv2.Rodrigues(rv1, R1);
    cv2.Rodrigues(rv2, R2);
    cv2.gemm(R1, R2, 1, new cv2.Mat(), 0, R, cv2.GEMM_1_T); // R = R1·R2ᵀ
    const tr = R.doubleAt(0, 0) + R.doubleAt(1, 1) + R.doubleAt(2, 2);
    const theta = Math.acos(Math.min(1, Math.max(-1, (tr - 1) / 2)));
    R.delete();
    R1.delete();
    R2.delete();
    return (theta * 180) / Math.PI;
  }

  /** translation distance normalised so that the full board diagonal → 180° */
  private _translationDeg(tv1: cv2.Mat, tv2: cv2.Mat): number {
    const dx = tv1.doubleAt(0, 0) - tv2.doubleAt(0, 0);
    const dy = tv1.doubleAt(1, 0) - tv2.doubleAt(1, 0);
    const dz = tv1.doubleAt(2, 0) - tv2.doubleAt(2, 0);
    return (Math.hypot(dx, dy, dz) / this.diag) * 180;
  }
}
