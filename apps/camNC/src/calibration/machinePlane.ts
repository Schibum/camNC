import { Box2, Vector2 } from 'three';

/**
 * Size and center (machine coordinates, mm) of a plane covering the machine bounds plus `overSize` margin.
 * Bounds don't necessarily start at 0, e.g. machines homing in positive direction have negative coordinates.
 */
export function getMachinePlaneLayout(bounds: Box2, overSize = 0) {
  const size = bounds.getSize(new Vector2());
  return {
    width: size.x + overSize,
    height: size.y + overSize,
    center: bounds.getCenter(new Vector2()),
  };
}
