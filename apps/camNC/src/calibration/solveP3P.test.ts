// import _cv from '@techstark/opencv-js';
import { ensureOpenCvIsLoaded } from '@wbcnc/load-opencv';
import { Matrix3, Vector2, Vector3 } from 'three';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { computeP3P } from './solveP3P';

// Avoid dynamic import of ensureOpenCvIsLoaded
// vi.stubGlobal('cv', _cv);

describe('computeP3P', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await ensureOpenCvIsLoaded();
  });

  it('should compute P3P solution with valid inputs', () => {
    // Define inputs based on Python example

    // Machine bounds (in machine coordinates)
    const mp = [new Vector3(0, 0, 0), new Vector3(0, 1243, 0), new Vector3(623, 1243, 0), new Vector3(623, 0, 0)];

    // Image points - corners2 from Python example
    const markersInCam: Vector2[] = [new Vector2(1570, 418), new Vector2(2209, 1599), new Vector2(901, 1893), new Vector2(959, 456)];

    // prettier-ignore
    const camMatrix = new Matrix3().set(
      1576.70915, 0.0, 1481.05363,
      0.0, 1717.4288, 969.448282,
      0.0, 0.0, 1.0
    );

    // Call the function
    const result = computeP3P(mp, markersInCam, camMatrix);
    expect(result.reprojectionError).toBeLessThan(1);
  });
});
