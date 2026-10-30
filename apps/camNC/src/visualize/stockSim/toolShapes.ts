import { ToolInfo } from '../guess-tools';

export type ToolKind = 'flat' | 'ball' | 'vbit';

export interface ToolShape {
  kind: ToolKind;
  /** Radius at the widest point that cuts, in mm. */
  radius: number;
  /** V-bits: half of the included tip angle, in degrees. */
  halfAngle?: number;
}

/** User choice for the tool shape: guessed from the tool table, or one shape for every tool. */
export type ToolShapeChoice = 'auto' | 'flat' | 'ball' | 'vbit60' | 'vbit90';

export const kToolShapeChoices: { value: ToolShapeChoice; label: string }[] = [
  { value: 'auto', label: 'Auto' },
  { value: 'flat', label: 'Flat' },
  { value: 'ball', label: 'Ball' },
  { value: 'vbit60', label: 'V 60°' },
  { value: 'vbit90', label: 'V 90°' },
];

/** Shape of a tool from a Fusion 360 tool table entry: tapered tools are V-bits, "ball" in the name means a ball end. */
export function shapeFromToolInfo(info: ToolInfo): ToolShape {
  const radius = info.diameter / 2;
  if (info.taper !== undefined && info.taper > 0 && info.taper < 90) return { kind: 'vbit', radius, halfAngle: info.taper };
  if (/ball|bull ?nose|radius/i.test(info.name) && !info.isFlat) return { kind: 'ball', radius };
  return { kind: 'flat', radius };
}

function shapeFromChoice(choice: Exclude<ToolShapeChoice, 'auto'>, radius: number): ToolShape {
  switch (choice) {
    case 'flat':
      return { kind: 'flat', radius };
    case 'ball':
      return { kind: 'ball', radius };
    case 'vbit60':
      return { kind: 'vbit', radius, halfAngle: 30 };
    case 'vbit90':
      return { kind: 'vbit', radius, halfAngle: 45 };
  }
}

/**
 * Tool shape for each tool number used in the job. The diameter comes from the tool table when the file has one,
 * otherwise from the tool diameter setting.
 */
export function resolveToolShape(
  tool: number | undefined,
  tools: ToolInfo[],
  fallbackDiameter: number,
  choice: ToolShapeChoice
): ToolShape {
  const info = tools.find(t => t.tool === tool) ?? (tools.length === 1 ? tools[0] : undefined);
  const radius = (info?.diameter ?? fallbackDiameter) / 2;
  if (choice !== 'auto') return shapeFromChoice(choice, radius);
  return info ? shapeFromToolInfo(info) : { kind: 'flat', radius };
}

/** Height of the tool's cutting surface above its tip, at distance `d` from its axis; Infinity outside the tool. */
export function toolProfile(shape: ToolShape, d: number): number {
  const r = shape.radius;
  if (d > r) return Infinity;
  switch (shape.kind) {
    case 'flat':
      return 0;
    case 'ball':
      return r - Math.sqrt(r * r - d * d);
    case 'vbit':
      return d / Math.tan(((shape.halfAngle ?? 45) * Math.PI) / 180);
  }
}

interface P3 {
  x: number;
  y: number;
  z: number;
}

/**
 * Lowest point the tool reaches at (`px`, `py`) while its tip moves in a straight line from `a` to `b`, or Infinity
 * when it does not pass over that point. Reference for the GPU stamping shader, which uses the same method.
 */
export function sweptToolDepth(shape: ToolShape, a: P3, b: P3, px: number, py: number, samples = 8): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const ox = a.x - px;
  const oy = a.y - py;
  const r = shape.radius;
  const len2 = dx * dx + dy * dy;
  // t interval along the segment where the point is within the tool radius.
  let t0 = 0;
  let t1 = 1;
  if (len2 < 1e-12) {
    if (ox * ox + oy * oy > r * r) return Infinity;
  } else {
    // |o + t*d|^2 = r^2
    const bq = (ox * dx + oy * dy) / len2;
    const cq = (ox * ox + oy * oy - r * r) / len2;
    const disc = bq * bq - cq;
    if (disc < 0) return Infinity;
    const s = Math.sqrt(disc);
    t0 = Math.max(-bq - s, 0);
    t1 = Math.min(-bq + s, 1);
    if (t0 > t1) return Infinity;
  }
  const depthAt = (t: number) => {
    const d = Math.hypot(ox + t * dx, oy + t * dy);
    return a.z + t * (b.z - a.z) + toolProfile(shape, Math.min(d, r));
  };
  // Flat tool: Z is linear in t, so the lowest point is at one end of the interval.
  if (shape.kind === 'flat') return Math.min(depthAt(t0), depthAt(t1));
  let best = Math.min(depthAt(t0), depthAt(t1));
  if (len2 >= 1e-12) {
    const closest = Math.min(Math.max(-(ox * dx + oy * dy) / len2, t0), t1);
    best = Math.min(best, depthAt(closest));
  }
  for (let i = 1; i < samples; i++) best = Math.min(best, depthAt(t0 + ((t1 - t0) * i) / samples));
  return best;
}
