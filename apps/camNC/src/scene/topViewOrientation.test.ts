import { Euler } from 'three';
import { describe, expect, it } from 'vitest';
import { axisStepLabel, kStandardScreenAxes, kTopViewCameraRotation, screenAxesForCamera, screenToMachine } from './topViewOrientation';

describe('screenAxesForCamera', () => {
  it('maps the unrotated camera to the standard layout', () => {
    expect(screenAxesForCamera(new Euler(0, 0, 0))).toEqual(kStandardScreenAxes);
  });

  it('maps the Top View camera to +X up, +Y left', () => {
    const axes = screenAxesForCamera(kTopViewCameraRotation);
    expect(axes).toEqual({ right: { x: 0, y: -1 }, up: { x: 1, y: 0 } });
    expect(screenToMachine(axes, 0, 1)).toEqual({ x: 1, y: 0 });
    expect(screenToMachine(axes, -1, 0)).toEqual({ x: 0, y: 1 });
    expect(screenToMachine(axes, 1, 1)).toEqual({ x: 1, y: -1 });
  });

  it('handles 90°, 180° and mirrored views', () => {
    expect(screenAxesForCamera(new Euler(0, 0, Math.PI / 2))).toEqual({ right: { x: 0, y: 1 }, up: { x: -1, y: 0 } });
    expect(screenAxesForCamera(new Euler(0, 0, Math.PI))).toEqual({ right: { x: -1, y: 0 }, up: { x: 0, y: -1 } });
    // Looking up from below mirrors Y.
    expect(screenAxesForCamera(new Euler(Math.PI, 0, 0))).toEqual({ right: { x: 1, y: 0 }, up: { x: 0, y: -1 } });
  });
});

describe('axisStepLabel', () => {
  it('labels single axes and diagonals', () => {
    expect(axisStepLabel({ x: 1, y: 0 })).toBe('X+');
    expect(axisStepLabel({ x: 0, y: -1 })).toBe('Y−');
    expect(axisStepLabel({ x: -1, y: 1 })).toBe('X−Y+');
  });
});
