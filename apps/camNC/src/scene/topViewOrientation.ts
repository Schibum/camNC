import { Euler, Vector3 } from 'three';

/**
 * Rotation of the orthographic camera in Top View. World space is machine space (the video is unprojected onto the
 * machine plane), so this alone decides how the machine appears on screen: +X points up, +Y points left.
 */
export const kTopViewCameraRotation = new Euler(0, 0, -Math.PI / 2);

/** Machine XY unit step (each component -1, 0 or 1). */
export interface AxisStep {
  x: number;
  y: number;
}

/** Machine XY directions that point right and up on screen. */
export interface ScreenAxes {
  right: AxisStep;
  up: AxisStep;
}

/** Standard layout: +X right, +Y up. */
export const kStandardScreenAxes: ScreenAxes = { right: { x: 1, y: 0 }, up: { x: 0, y: 1 } };

function snapToAxis(v: Vector3): AxisStep {
  return Math.abs(v.x) >= Math.abs(v.y) ? { x: Math.sign(v.x), y: 0 } : { x: 0, y: Math.sign(v.y) };
}

/**
 * Derives which machine axis points right / up on screen for a top-down camera with the given rotation, snapped to the
 * nearest axis. Covers any multiple of 90° and mirrored views (e.g. a camera looking up from below).
 */
export function screenAxesForCamera(rotation: Euler): ScreenAxes {
  return {
    right: snapToAxis(new Vector3(1, 0, 0).applyEuler(rotation)),
    up: snapToAxis(new Vector3(0, 1, 0).applyEuler(rotation)),
  };
}

/** Converts a screen direction (sx right, sy up, each -1..1) to a machine XY step. */
export function screenToMachine(axes: ScreenAxes, sx: number, sy: number): AxisStep {
  // `+ 0` turns -0 into 0.
  return { x: sx * axes.right.x + sy * axes.up.x + 0, y: sx * axes.right.y + sy * axes.up.y + 0 };
}

/** Label for a machine step, e.g. "X+", "Y−" or "X+Y−". */
export function axisStepLabel(step: AxisStep): string {
  const part = (axis: string, v: number) => (v === 0 ? '' : `${axis}${v > 0 ? '+' : '−'}`);
  return part('X', step.x) + part('Y', step.y);
}
