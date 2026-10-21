import { cv2, ensureOpenCvIsLoaded } from '@wbcnc/load-opencv';
import { beforeAll, describe, expect, it } from 'vitest';
import { calibrateCamera, createObjectPoints } from './calibrationCore';
import { CapturedFrame } from './calibrationTypes';

const patternSize = { width: 9, height: 6 };
const frameSize = { width: 640, height: 480 };
const K = [500, 0, 320, 0, 520, 240, 0, 0, 1];

/** Project the chessboard corners for a given pose with a known pinhole camera. */
function syntheticFrame(rvec: number[], tvec: number[], id: number): CapturedFrame {
  const objp = createObjectPoints(patternSize);
  const r = cv2.matFromArray(3, 1, cv2.CV_64F, rvec);
  const t = cv2.matFromArray(3, 1, cv2.CV_64F, tvec);
  const k = cv2.matFromArray(3, 3, cv2.CV_64F, K);
  const dist = cv2.Mat.zeros(1, 5, cv2.CV_64F);
  const imgPts = new cv2.Mat();
  cv2.projectPoints(objp, r, t, k, dist, imgPts);
  // Float32 object points yield float32 image points.
  const corners = Array.from({ length: imgPts.rows }, (_, i) => ({ x: imgPts.data32F[i * 2]!, y: imgPts.data32F[i * 2 + 1]! }));
  [objp, r, t, k, dist, imgPts].forEach(m => m.delete());
  return { id: String(id), imageBlob: null, corners, timestamp: id };
}

describe('calibrateCamera', () => {
  beforeAll(async () => {
    await ensureOpenCvIsLoaded();
  });

  it('recovers the camera matrix from synthetic views', () => {
    const poses: [number[], number[]][] = [
      [
        [0.1, 0.2, 0],
        [-4, -3, 12],
      ],
      [
        [-0.3, 0.1, 0.1],
        [-4, -2, 11],
      ],
      [
        [0.2, -0.3, -0.1],
        [-3, -3, 13],
      ],
      [
        [0.4, 0.3, 0.05],
        [-5, -2, 12],
      ],
      [
        [-0.2, -0.4, 0.2],
        [-3, -4, 14],
      ],
    ];
    const frames = poses.map(([r, t], i) => syntheticFrame(r, t, i));

    const result = calibrateCamera(frames, patternSize, frameSize);

    expect(result.rms).toBeLessThan(0.01);
    expect(result.cameraMatrix[0]![0]).toBeCloseTo(500, 0);
    expect(result.cameraMatrix[1]![1]).toBeCloseTo(520, 0);
    expect(result.cameraMatrix[0]![2]).toBeCloseTo(320, 0);
    expect(result.cameraMatrix[1]![2]).toBeCloseTo(240, 0);
    expect(result.perViewErrors).toHaveLength(frames.length);
  });

  it('requires at least 3 frames', () => {
    expect(() => calibrateCamera([], patternSize, frameSize)).toThrow(/At least 3 frames/);
  });
});
