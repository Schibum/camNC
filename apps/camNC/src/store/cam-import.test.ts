import { Matrix3, Vector2, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { hasSetup, importSetup, suggestImportSource } from './cam-import';
import { ICamSource } from './store';

function setUpCam(): ICamSource {
  return {
    name: 'Reolink via go2rtc',
    url: 'go2rtc://localhost:1984?src=rtsp%3A%2F%2Fadmin%3Apw%40192.168.178.183%3A554%2Fh264Preview_01_main',
    maxResolution: [2560, 1920],
    calibration: {
      calibration_matrix: new Matrix3().set(2000, 0, 1280, 0, 2000, 960, 0, 0, 1),
      new_camera_matrix: new Matrix3().set(1900, 0, 1270, 0, 1900, 950, 0, 0, 1),
      distortion_coefficients: [0.1, -0.2, 0, 0, 0.05],
    },
    extrinsics: { R: new Matrix3().identity(), t: new Vector3(1, 2, 3) },
    markerPosInCam: [new Vector2(100, 200)],
    markerPositions: [new Vector3(0, 0, 0), new Vector3(500, 0, 0)],
    arucoTagSize: 40,
  };
}

function newCam(url: string, maxResolution: [number, number]): ICamSource {
  return { name: 'new', url, maxResolution };
}

describe('importSetup', () => {
  it('copies everything for the same camera in the same spot', () => {
    const from = setUpCam();
    const changes = importSetup(newCam('rtsp://192.168.178.183:554/h264Preview_01_main', [2560, 1920]), from, 'same-spot');
    expect(changes.calibration!.calibration_matrix.elements).toEqual(from.calibration!.calibration_matrix.elements);
    expect(changes.extrinsics!.t.toArray()).toEqual([1, 2, 3]);
    expect(changes.markerPosInCam!.map(p => p.toArray())).toEqual([[100, 200]]);
    expect(changes.markerPositions).toHaveLength(2);
    expect(changes.arucoTagSize).toBe(40);
    // Copies, so later changes to one camera don't touch the other.
    expect(changes.markerPositions![0]).not.toBe(from.markerPositions![0]);
  });

  it('rescales for another resolution with the same aspect ratio', () => {
    const changes = importSetup(newCam('webcam:', [1280, 960]), setUpCam(), 'same-spot');
    expect(changes.calibration!.calibration_matrix.elements).toEqual(new Matrix3().set(1000, 0, 640, 0, 1000, 480, 0, 0, 1).elements);
    expect(changes.markerPosInCam!.map(p => p.toArray())).toEqual([[50, 100]]);
    expect(changes.extrinsics).toBeDefined();
  });

  it('keeps only the lens and markers on the machine when the camera moved', () => {
    const changes = importSetup(newCam('webcam:', [2560, 1920]), setUpCam(), 'moved');
    expect(changes.calibration).toBeDefined();
    expect(changes.markerPositions).toHaveLength(2);
    expect(changes.markerPosInCam).toBeUndefined();
    expect(changes.extrinsics).toBeUndefined();
  });

  it('keeps only the markers on the machine for another camera, or another aspect ratio', () => {
    for (const changes of [
      importSetup(newCam('webcam:', [2560, 1920]), setUpCam(), 'other-camera'),
      importSetup(newCam('webcam:', [1920, 1080]), setUpCam(), 'same-spot'),
    ]) {
      expect(changes.calibration).toBeUndefined();
      expect(changes.extrinsics).toBeUndefined();
      expect(changes.markerPosInCam).toBeUndefined();
      expect(changes.markerPositions).toHaveLength(2);
      expect(changes.arucoTagSize).toBe(40);
    }
  });
});

describe('suggestImportSource', () => {
  const webcam: ICamSource = { ...setUpCam(), url: 'webcam:?deviceId=abc', maxResolution: [1920, 1080] };
  const empty: ICamSource = newCam('webcam:', [2560, 1920]);

  it('prefers the camera at the same address, even through go2rtc', () => {
    const target = newCam('rtsp://admin:x@192.168.178.183:554/h264Preview_01_sub', [640, 480]);
    expect(
      suggestImportSource(
        [
          ['webcam', webcam],
          ['reolink', setUpCam()],
          ['target', target],
        ],
        target
      )
    ).toBe('reolink');
  });

  it('falls back to the same resolution, then the first camera with a setup', () => {
    const target = newCam('webcam:?deviceId=x', [1920, 1080]);
    const cams: [string, ICamSource][] = [
      ['empty', empty],
      ['reolink', setUpCam()],
      ['webcam', webcam],
    ];
    expect(suggestImportSource(cams, target)).toBe('webcam');
    expect(suggestImportSource(cams, newCam('webcam:', [800, 600]))).toBe('reolink');
    expect(suggestImportSource([['empty', empty]], target)).toBeUndefined();
    expect(hasSetup(empty)).toBe(false);
  });
});
