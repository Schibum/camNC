/* ------------------------------------------------------------------
   PoseUniquenessGate  –  keep only frames whose (R,t) differs enough
   ------------------------------------------------------------------ */
import { cv2 } from "@wbcnc/load-opencv";
import { createObjectPoints } from "../lib/calibrationCore";
import { Corner, PatternSize } from "../lib/calibrationTypes";

interface Pose {
  rvec: cv2.Mat;
  tvec: cv2.Mat;
}

export class PoseUniquenessGate {
  private readonly diag: number; // pattern diagonal (world u.)
  private readonly objPts: cv2.Mat; // cached 3-D board coords
  private poses: Pose[] = [];

  constructor(
    private readonly pattern: PatternSize,
    private readonly squareSize = 1.0
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
  }

  /** ---- public entry ----
         returns true  ⇢  frame is sufficiently different & stored
                  false ⇢  too similar, ignore it                     */
  accept(
    corners: Corner[],
    frameW: number,
    frameH: number,
    thresh = 90,
    rotWeight = 3,
    traWeight = 1
  ): boolean {
    // 1. build image-point Mat
    const img = new cv2.Mat(corners.length, 1, cv2.CV_32FC2);
    corners.forEach((c, i) => {
      img.floatPtr(i, 0)[0] = c.x;
      img.floatPtr(i, 0)[1] = c.y;
    });

    // 2. very rough intrinsics guess (good enough for pose distance)
    const fGuess = Math.max(frameW, frameH);
    const K = cv2.matFromArray(3, 3, cv2.CV_64F, [
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

    const rvec = new cv2.Mat();
    const tvec = new cv2.Mat();
    cv2.solvePnP(
      this.objPts,
      img,
      K,
      new cv2.Mat(),
      rvec,
      tvec,
      false,
      cv2.SOLVEPNP_ITERATIVE
    );

    img.delete();
    K.delete();

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
    console.log(`[Pug] score: ${minScore}`);

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
