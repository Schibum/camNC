import { Color, Vector3 } from 'three';
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
 * Depth colors per path point (rgb triples), adjusted to stay readable against `background`.
 */
function getContrastingZHeightColors(toolpath: ParsedToolpath, background: Color) {
  const colors = getZHeightColors(toolpath);
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

/** Closest point to `point` on the segment ending at path point `index`. */
export function closestPointOnSegment(toolpath: ParsedToolpath, index: number, point: Vector3): Vector3 {
  const a = toolpath.pathPoints[index - 1];
  const b = toolpath.pathPoints[index];
  const ab = new Vector3().subVectors(b, a);
  const lengthSq = ab.lengthSq();
  const t = lengthSq === 0 ? 0 : Math.min(1, Math.max(0, new Vector3().subVectors(point, a).dot(ab) / lengthSq));
  return a.clone().addScaledVector(ab, t);
}
