// apps/camNC/src/lib/image-geometry.ts
// Helper utilities that deal with image-plane geometry, projection and
// camera-model conversions.  These functions are **pure math** and do not
// depend on WebGL, React or OpenCV, which keeps them usable from both
// the main thread and Web-Workers.

import { CalibrationData } from '@/store/store';
import * as THREE from 'three';

/**
 * Convert a pixel in the *undistorted* image (a.k.a. the image produced by
 * `new_camera_matrix`) to the corresponding pixel in the *distorted* (raw)
 * sensor image described by `calibration_matrix` + `distortion_coefficients`.
 *
 * This is the analytic inverse of OpenCV's `undistortPoints` / the inner loop
 * of our JS re-implementation `initUndistortRectifyMapTyped`.  The maths is
 * duplicated here so we can convert *individual* points without any OpenCV
 * dependency.
 *
 * @param undist  Pixel in the undistorted image (units: pixels).
 * @param calib   Camera calibration data as stored in Zustand.
 * @returns       Pixel coordinate in the original, distorted image.
 */
export function undistortedToDistorted(undist: THREE.Vector2, calib: CalibrationData): THREE.Vector2 {
  const { calibration_matrix: C, new_camera_matrix: Cnew, distortion_coefficients: d } = calib;

  // 1. Normalise with NEW camera matrix (undistorted intrinsics).
  const fxNew = Cnew.elements[0];
  const fyNew = Cnew.elements[4];
  const cxNew = Cnew.elements[6];
  const cyNew = Cnew.elements[7];

  const x = (undist.x - cxNew) / fxNew;
  const y = (undist.y - cyNew) / fyNew;

  // 2. Apply radial + tangential distortion to get coordinates in the
  //    *distorted* normalised image plane.
  const k1 = d[0] ?? 0;
  const k2 = d[1] ?? 0;
  const p1 = d[2] ?? 0;
  const p2 = d[3] ?? 0;
  const k3 = d[4] ?? 0;

  const r2 = x * x + y * y;
  const radial = 1 + k1 * r2 + k2 * r2 * r2 + k3 * r2 * r2 * r2;
  const deltaX = 2 * p1 * x * y + p2 * (r2 + 2 * x * x);
  const deltaY = p1 * (r2 + 2 * y * y) + 2 * p2 * x * y;

  const xd = x * radial + deltaX;
  const yd = y * radial + deltaY;

  // 3. Project back using the ORIGINAL camera matrix.
  const fx = C.elements[0];
  const fy = C.elements[4];
  const cx = C.elements[6];
  const cy = C.elements[7];

  return new THREE.Vector2(fx * xd + cx, fy * yd + cy);
}

/**
 * Faster variant that uses the already computed undistortion maps.
 *
 * Because `calculateUndistortionMapsCached` keeps the last maps globally, you
 * can obtain them once and reuse them for as many points as you like.  This
 * variant is nothing more than a table lookup (nearest-neighbour) and therefore
 * extremely cheap.  If the undistorted pixel lies outside the destination
 * image bounds, `null` is returned.
 */
export function undistortedToDistortedFast(
  undist: THREE.Vector2,
  mapX: Float32Array,
  mapY: Float32Array,
  width: number,
  height: number
): THREE.Vector2 | null {
  const u = Math.round(undist.x);
  const v = Math.round(undist.y);

  if (u < 0 || u >= width || v < 0 || v >= height) {
    return null;
  }

  const idx = v * width + u;
  return new THREE.Vector2(mapX[idx], mapY[idx]);
}
