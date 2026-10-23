import { Box2, Color, Vector2, Vector3 } from 'three';
import { ParsedToolpath } from './gcodeParsing';
import { getZHeightColors } from './toolpathColors';

/**
 * A Z level at which the tool moves horizontally while cutting (i.e. a depth pass).
 */
export interface DepthLevel {
  z: number;
  // Accumulated XY length of horizontal cutting moves at this level (mm).
  length: number;
}

/**
 * Line segment buffers for rendering a toolpath in 3D. Segments are split into
 * cutting and rapid (G0) moves so they can be styled separately.
 * `*SegmentIndex[k]` maps the k-th rendered segment back to the index of its end
 * point in `toolpath.pathPoints`.
 */
export interface DepthGeometryData {
  cutPositions: Float32Array;
  cutColors: Float32Array;
  cutSegmentIndex: Uint32Array;
  rapidPositions: Float32Array;
  rapidSegmentIndex: Uint32Array;
}

/** Where the toolpath's Z0 lies on the stock. */
export type ZeroAt = 'top' | 'bottom';

/**
 * Guess the Z0 placement of a toolpath: zeroed on the stock bottom (or table) when it never goes
 * below 0 but rises above the stock top, on the stock top otherwise.
 */
export function guessZeroAt(toolpath: ParsedToolpath, stockHeight: number, tolerance = 1e-3): ZeroAt {
  const { min, max } = toolpath.getBounds();
  return stockHeight > 0 && min.z >= -tolerance && max.z > stockHeight + tolerance ? 'bottom' : 'top';
}

/** XY area of the stock shown in the 3D views (work coordinates): the toolpath bounds plus a small margin. */
export function getStockFootprint(toolpath: ParsedToolpath): Box2 {
  const bounds = toolpath.getBounds();
  const pad = Math.max(bounds.max.x - bounds.min.x, bounds.max.y - bounds.min.y, 1) * 0.05;
  return new Box2(new Vector2(bounds.min.x - pad, bounds.min.y - pad), new Vector2(bounds.max.x + pad, bounds.max.y + pad));
}

/** Motion mode (G0, G1, G2, ...) of the segment ending at path point `index`. */
export function getSegmentMotion(toolpath: ParsedToolpath, index: number): string | undefined {
  return toolpath.modals[index]?.motion;
}

export function isRapidSegment(toolpath: ParsedToolpath, index: number): boolean {
  return getSegmentMotion(toolpath, index) === 'G0';
}

/**
 * Collect the distinct Z levels of horizontal cutting moves, sorted from deepest
 * to highest. Levels closer than `tolerance` are merged. Levels with less than
 * `minLength` of horizontal travel (e.g. fragments of 3D contours or ramps) are dropped.
 */
export function getCutDepthLevels(toolpath: ParsedToolpath, { tolerance = 0.005, minLength = 1 } = {}): DepthLevel[] {
  const levels: DepthLevel[] = [];
  const points = toolpath.pathPoints;
  for (let i = 1; i < points.length; i++) {
    if (isRapidSegment(toolpath, i)) continue;
    const p0 = points[i - 1];
    const p1 = points[i];
    if (Math.abs(p1.z - p0.z) > tolerance) continue;
    const length = Math.hypot(p1.x - p0.x, p1.y - p0.y);
    if (length === 0) continue;
    const z = (p0.z + p1.z) / 2;
    const level = levels.find(l => Math.abs(l.z - z) <= tolerance);
    if (level) {
      level.length += length;
    } else {
      levels.push({ z, length });
    }
  }
  return levels.filter(l => l.length >= minLength).sort((a, b) => a.z - b.z);
}

/** WCAG relative luminance of a color in linear sRGB (three's working color space). */
function relativeLuminance(color: Color) {
  return 0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b;
}

export function contrastRatio(a: Color, b: Color) {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * Return `color`, moved towards white or black (whichever is further from the
 * background) just enough to reach `minRatio` contrast against `background`.
 */
export function withMinContrast(color: Color, background: Color, minRatio = 4.5): Color {
  if (contrastRatio(color, background) >= minRatio) return color.clone();
  const target = relativeLuminance(background) < 0.18 ? new Color(1, 1, 1) : new Color(0, 0, 0);
  // Contrast grows monotonically while blending towards the target, binary search the smallest blend.
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 20; i++) {
    const mid = (lo + hi) / 2;
    if (contrastRatio(color.clone().lerp(target, mid), background) >= minRatio) hi = mid;
    else lo = mid;
  }
  return color.clone().lerp(target, hi);
}

/**
 * Z range the depth colors spread over: from the deepest cut to the highest cut level. Plunges and retracts above
 * the highest level get its color, otherwise retract heights would squeeze all cut depths into one end of the map.
 */
export function getCutZRange(toolpath: ParsedToolpath): { min: number; max: number } {
  const points = toolpath.pathPoints;
  let min = Infinity;
  let max = -Infinity;
  for (let i = 1; i < points.length; i++) {
    if (isRapidSegment(toolpath, i)) continue;
    min = Math.min(min, points[i - 1].z, points[i].z);
    max = Math.max(max, points[i - 1].z, points[i].z);
  }
  if (min > max) {
    const bounds = toolpath.getBounds();
    return { min: bounds.min.z, max: bounds.max.z };
  }
  const levels = getCutDepthLevels(toolpath);
  const highestLevel = levels.at(-1)?.z;
  return { min, max: highestLevel !== undefined && highestLevel > min ? highestLevel : max };
}

/**
 * Depth colors per path point (rgb triples) over the cutting Z range, adjusted to stay readable against `background`.
 */
function getContrastingZHeightColors(toolpath: ParsedToolpath, background: Color) {
  const colors = getZHeightColors(toolpath, getCutZRange(toolpath));
  const color = new Color();
  for (let i = 0; i < colors.length; i += 3) {
    withMinContrast(color.setRGB(colors[i], colors[i + 1], colors[i + 2]), background).toArray(colors, i);
  }
  return colors;
}

export function buildDepthGeometryData(toolpath: ParsedToolpath, background: Color): DepthGeometryData {
  const points = toolpath.pathPoints;
  const colors = getContrastingZHeightColors(toolpath, background);
  const cutPositions: number[] = [];
  const cutColors: number[] = [];
  const cutSegmentIndex: number[] = [];
  const rapidPositions: number[] = [];
  const rapidSegmentIndex: number[] = [];

  for (let i = 1; i < points.length; i++) {
    const p0 = points[i - 1];
    const p1 = points[i];
    if (p0.equals(p1)) continue;
    if (isRapidSegment(toolpath, i)) {
      rapidPositions.push(p0.x, p0.y, p0.z, p1.x, p1.y, p1.z);
      rapidSegmentIndex.push(i);
    } else {
      cutPositions.push(p0.x, p0.y, p0.z, p1.x, p1.y, p1.z);
      cutColors.push(...colors.slice((i - 1) * 3, i * 3 + 3));
      cutSegmentIndex.push(i);
    }
  }

  return {
    cutPositions: new Float32Array(cutPositions),
    cutColors: new Float32Array(cutColors),
    cutSegmentIndex: new Uint32Array(cutSegmentIndex),
    rapidPositions: new Float32Array(rapidPositions),
    rapidSegmentIndex: new Uint32Array(rapidSegmentIndex),
  };
}

/**
 * Segment colors with every segment outside the level at `z` grayed and faded towards `background`, to make one depth pass
 * stand out. `positions` and `colors` are per segment endpoint, as in `DepthGeometryData`.
 */
export function fadeOutsideLevel(
  positions: Float32Array,
  colors: Float32Array,
  z: number,
  background: Color,
  { tolerance = 0.005, fade = 0.6 } = {}
): Float32Array {
  const faded = new Float32Array(colors);
  // Six floats per segment: two endpoints with three components each.
  for (let i = 0; i < positions.length; i += 6) {
    const onLevel = Math.abs(positions[i + 2] - z) <= tolerance && Math.abs(positions[i + 5] - z) <= tolerance;
    if (onLevel) continue;
    for (let j = i; j < i + 6; j += 3) {
      // Desaturate, so only the level keeps its depth color, then fade.
      const gray = 0.2126 * faded[j] + 0.7152 * faded[j + 1] + 0.0722 * faded[j + 2];
      faded[j] = gray + (background.r - gray) * fade;
      faded[j + 1] = gray + (background.g - gray) * fade;
      faded[j + 2] = gray + (background.b - gray) * fade;
    }
  }
  return faded;
}

/** Positions of the segments at the level `z` (both endpoints within `tolerance`), as in `DepthGeometryData`. */
export function getLevelSegmentPositions(positions: Float32Array, z: number, tolerance = 0.005): Float32Array {
  const level: number[] = [];
  for (let i = 0; i < positions.length; i += 6) {
    if (Math.abs(positions[i + 2] - z) <= tolerance && Math.abs(positions[i + 5] - z) <= tolerance) {
      level.push(...positions.subarray(i, i + 6));
    }
  }
  return new Float32Array(level);
}

/** Closest point to `point` on the segment ending at path point `index`. */
export function closestPointOnSegment(toolpath: ParsedToolpath, index: number, point: Vector3): Vector3 {
  const a = toolpath.pathPoints[index - 1];
  const b = toolpath.pathPoints[index];
  const ab = new Vector3().subVectors(b, a);
  const lengthSq = ab.lengthSq();
  const t = lengthSq === 0 ? 0 : Math.min(1, Math.max(0, new Vector3().subVectors(point, a).dot(ab) / lengthSq));
  return a.clone().addScaledVector(ab, t);
}

// Minimum on-screen distance between two level labels.
const kMinLabelSpacingPx = 18;

/**
 * Levels to label: deepest first, skipping levels that would overlap the previous label at the current zoom and
 * tilt. The selected level is always labeled.
 */
export function pickLabelLevels(levels: DepthLevel[], pxPerMm: number, selected: number | null, minSpacingPx = kMinLabelSpacingPx) {
  const picked: number[] = [];
  for (const level of levels) {
    const last = picked.at(-1);
    if (last === undefined || (level.z - last) * pxPerMm >= minSpacingPx) picked.push(level.z);
  }
  if (selected !== null && !picked.includes(selected)) {
    // Replace labels too close to the selected one.
    const kept = picked.filter(z => Math.abs(z - selected) * pxPerMm >= minSpacingPx);
    return [...kept, selected].sort((a, b) => a - b);
  }
  return picked;
}
