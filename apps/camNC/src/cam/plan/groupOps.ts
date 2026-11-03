import type { OpSummary } from '../camTypes';

/** Rows of the operations table: identical operations of a part shown once, with a count. */
export interface OpGroup {
  key: string;
  /** e.g. "vert1 · Through hole" */
  label: string;
  count: number;
  /** Indices into the program's operations (cut order), first one first. */
  members: number[];
  op: OpSummary;
  timeMin: number;
  /** A guided program's row: what it stops for, "8 pauses: take out each part". Its count is laps or tabs, not copies. */
  note?: string;
}

/**
 * Group operations that do the same thing on the same part: same label (part + kind + depth), bit, depth range and
 * feeds, e.g. three through holes. A guided program after the cutting is one row. Rows keep the order of their first
 * operation; the cut order doesn't change.
 */
export function groupOps(ops: OpSummary[]): OpGroup[] {
  const groups = new Map<string, OpGroup>();
  ops.forEach((op, i) => {
    const key = op.program
      ? `program|${op.program.kind}`
      : [op.label, op.tool.diameter, op.zTop.toFixed(2), op.zBottom.toFixed(2), op.depthSteps, op.feeds.join('/')].join('|');
    const g = groups.get(key);
    if (g) {
      g.count++;
      g.members.push(i);
      g.timeMin += op.timeMin;
    } else
      groups.set(key, {
        key,
        label: op.program?.title ?? op.label,
        count: 1,
        members: [i],
        op,
        timeMin: op.timeMin,
        ...(op.program && { note: op.program.note }),
      });
  });
  return [...groups.values()];
}
