import { readGcode } from './analyze';

export interface SafetyLimits {
  /** Z of the stock top (Z0 = stock bottom). */
  stockTop: number;
  /** Board size in X and Y (the part's bounding box, X0 Y0 at its lower left). */
  size: [number, number];
  /** Deepest allowed Z (the through-cut depth, e.g. -0.3). */
  minZ: number;
  /** Largest tool radius used: tool centers may go this far + `margin` outside the board. */
  toolRadius: number;
  /** Extra room outside the board: open pockets run r+1mm past the edge, outlines r+leave. Default 1.5 mm. */
  margin?: number;
  /** Rapids must stay this far above the stock top. Default 0.5 mm. */
  rapidClearance?: number;
}

export interface SafetyIssue {
  rule: 'rapid-in-stock' | 'outside-board' | 'too-deep';
  /** Index of the offending move (arcs count once per chord). */
  move: number;
  message: string;
}

/**
 * Rules every generated program must keep, whatever the settings: no rapid move into or through the stock (below its
 * top + clearance; straight-up retracts are fine), no move outside the board (+ tool radius and margin), never deeper
 * than the through-cut depth.
 */
export function checkGcodeSafety(gcode: string, limits: SafetyLimits): SafetyIssue[] {
  const margin = limits.margin ?? 1.5;
  const clearance = limits.rapidClearance ?? 0.5;
  const reach = limits.toolRadius + margin;
  const issues: SafetyIssue[] = [];
  const fmt = (p: number[]) => p.map(v => +v.toFixed(3)).join(', ');
  readGcode(gcode).forEach((m, i) => {
    // The machine starts wherever it is: the first move only says where it goes.
    if (i === 0 && m.rapid) return;
    const lowest = Math.min(m.from[2], m.to[2]);
    const sideways = Math.hypot(m.to[0] - m.from[0], m.to[1] - m.from[1]) > 1e-6;
    // Retracting straight up out of a cut is fine; ending low or moving sideways while low is not.
    if (m.rapid && (m.to[2] < limits.stockTop + clearance || (sideways && lowest < limits.stockTop + clearance)))
      issues.push({
        rule: 'rapid-in-stock',
        move: i,
        message: `rapid move at Z${+lowest.toFixed(3)} to (${fmt(m.to)}) is inside the stock`,
      });
    const [x, y] = m.to;
    const inside = x >= -reach && y >= -reach && x <= limits.size[0] + reach && y <= limits.size[1] + reach;
    if (!inside && lowest < limits.stockTop + clearance)
      issues.push({ rule: 'outside-board', move: i, message: `move to (${fmt(m.to)}) leaves the board` });
    if (m.to[2] < limits.minZ - 1e-3)
      issues.push({ rule: 'too-deep', move: i, message: `move to Z${+m.to[2].toFixed(3)} is below ${limits.minZ}` });
  });
  return issues;
}
