import { Matrix3 } from 'three';
import { CalibrationData, ICamSource, ITuple } from './store';

/** Relative difference in aspect ratio still treated as the same picture, e.g. 1920×1080 vs 1280×720. */
const kAspectTolerance = 0.01;

/**
 * The camera settings to keep when the video resolution of a camera changes, e.g. after switching it to another
 * source of the same camera. Pixel-based values (intrinsics, marker positions in the picture) are rescaled when the
 * picture keeps its aspect ratio; the camera's pose (extrinsics) does not depend on the resolution and stays. With a
 * different aspect ratio the picture is cropped differently, so the calibration and marker positions are dropped.
 */
export function adaptCamToResolution(cam: ICamSource, resolution: ITuple): Partial<ICamSource> {
  const [oldWidth, oldHeight] = cam.maxResolution;
  const [width, height] = resolution;
  if (oldWidth === width && oldHeight === height) return {};
  const sx = width / oldWidth;
  const sy = height / oldHeight;
  if (Math.abs(sx / sy - 1) > kAspectTolerance) {
    return { calibration: undefined, extrinsics: undefined, markerPosInCam: undefined };
  }
  return {
    calibration: cam.calibration && scaleCalibration(cam.calibration, sx, sy),
    markerPosInCam: cam.markerPosInCam?.map(p => p.clone().set(p.x * sx, p.y * sy)),
  };
}

function scaleCalibration(calibration: CalibrationData, sx: number, sy: number): CalibrationData {
  // Focal lengths and principal point are in pixels; distortion works on normalized coordinates and is unchanged.
  const scale = new Matrix3().set(sx, 0, 0, 0, sy, 0, 0, 0, 1);
  return {
    calibration_matrix: scale.clone().multiply(calibration.calibration_matrix),
    new_camera_matrix: scale.clone().multiply(calibration.new_camera_matrix),
    distortion_coefficients: [...calibration.distortion_coefficients],
  };
}

/** Whether the camera has been set up far enough to show the machine in its picture. */
export function isCamCalibrated(cam: ICamSource | null | undefined) {
  return !!cam?.calibration && !!cam.markerPosInCam?.length;
}
