import { Matrix3, Vector2, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { adaptCamToResolution } from './cam-resolution';
import { ICamSource } from './store';

function calibratedCam(): ICamSource {
  return {
    name: 'cam',
    url: 'go2rtc://localhost:1984?src=cam',
    maxResolution: [1920, 1080],
    calibration: {
      calibration_matrix: new Matrix3().set(1500, 0, 960, 0, 1500, 540, 0, 0, 1),
      new_camera_matrix: new Matrix3().set(1400, 0, 950, 0, 1400, 530, 0, 0, 1),
      distortion_coefficients: [0.1, -0.2, 0, 0, 0.05],
    },
    extrinsics: { R: new Matrix3().identity(), t: new Vector3(1, 2, 3) },
    markerPosInCam: [new Vector2(100, 200), new Vector2(1800, 1000)],
  };
}

describe('adaptCamToResolution', () => {
  it('keeps everything at the same resolution', () => {
    expect(adaptCamToResolution(calibratedCam(), [1920, 1080])).toEqual({});
  });

  it('scales intrinsics and marker pixels for the same aspect ratio', () => {
    const cam = calibratedCam();
    const changes = adaptCamToResolution(cam, [1280, 720]);
    expect(changes.calibration!.calibration_matrix.elements).toEqual(new Matrix3().set(1000, 0, 640, 0, 1000, 360, 0, 0, 1).elements);
    expect(changes.calibration!.distortion_coefficients).toEqual([0.1, -0.2, 0, 0, 0.05]);
    expect(changes.markerPosInCam!.map(p => p.toArray())).toEqual([
      [100 * (2 / 3), 200 * (2 / 3)],
      [1200, 1000 * (2 / 3)],
    ]);
    expect('extrinsics' in changes).toBe(false);
    // The original stays untouched.
    expect(cam.markerPosInCam![0].x).toBe(100);
  });

  it('drops the calibration when the aspect ratio changes', () => {
    expect(adaptCamToResolution(calibratedCam(), [1280, 960])).toEqual({
      calibration: undefined,
      extrinsics: undefined,
      markerPosInCam: undefined,
    });
  });
});
