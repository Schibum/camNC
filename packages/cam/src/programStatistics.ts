import { validateFluidNCOutput } from './postValidation';

export interface ProgramStatistics {
  bytes: number;
  executableBlocks: number;
  motionBlocks: number;
  arcBlocks: number;
  cuttingLineBlocks: number;
  feedChanges: number;
  tinyCuttingLines: number;
  tinySegmentThresholdMm: number;
  unresolvedCuttingLines: number;
  minimumCuttingLineMm: number | null;
  averageCuttingLineMm: number | null;
  maximumLineBytes: number;
}

/** Block metrics for this post's metric, absolute command subset; arcs count once, not per display chord. */
export function programStatistics(program: string, tinySegmentThresholdMm = 0.1): ProgramStatistics {
  if (!Number.isFinite(tinySegmentThresholdMm) || tinySegmentThresholdMm <= 0) throw new Error('Tiny-segment threshold must be positive');
  validateFluidNCOutput(program);
  const encoder = new TextEncoder();
  const result: ProgramStatistics = {
    bytes: encoder.encode(program).length,
    executableBlocks: 0,
    motionBlocks: 0,
    arcBlocks: 0,
    cuttingLineBlocks: 0,
    feedChanges: 0,
    tinyCuttingLines: 0,
    tinySegmentThresholdMm,
    unresolvedCuttingLines: 0,
    minimumCuttingLineMm: null,
    averageCuttingLineMm: null,
    maximumLineBytes: 0,
  };
  let motion = 0,
    feed: number | undefined,
    totalLength = 0,
    measured = 0;
  let position: (number | undefined)[] = [undefined, undefined, undefined];
  for (const raw of program.split(/\r?\n/)) {
    result.maximumLineBytes = Math.max(result.maximumLineBytes, encoder.encode(raw).length);
    const line = raw.replace(/\([^()]*\)/g, '').trim();
    if (!line) continue;
    result.executableBlocks++;
    const words = [...line.matchAll(/([A-Z])(-?(?:\d+(?:\.\d*)?|\.\d+))/g)].map(match => [match[1], Number(match[2])] as const);
    const values = Object.fromEntries(words);
    const codes = words.filter(([letter]) => letter === 'G').map(([, value]) => value);
    for (const code of codes) if (code <= 3) motion = code;
    if (values.F !== undefined && values.F !== feed) {
      result.feedChanges++;
      feed = values.F;
    }
    const axes = ['X', 'Y', 'Z'];
    const moving =
      axes.some(axis => values[axis] !== undefined) ||
      ((motion === 2 || motion === 3) && ['I', 'J', 'K'].some(axis => values[axis] !== undefined));
    if (!moving || codes.includes(4)) continue;
    result.motionBlocks++;
    if (codes.includes(53)) {
      position = position.map((value, axis) => (values[axes[axis]] === undefined ? value : undefined));
      continue;
    }
    const target = axes.map((axis, i) => values[axis] ?? position[i]);
    if (motion === 2 || motion === 3) result.arcBlocks++;
    else if (motion === 1) {
      result.cuttingLineBlocks++;
      if (position.some(value => value === undefined) || target.some(value => value === undefined)) result.unresolvedCuttingLines++;
      else {
        const length = Math.hypot(...target.map((value, i) => value! - position[i]!));
        if (length > 0) {
          totalLength += length;
          measured++;
          result.minimumCuttingLineMm = Math.min(result.minimumCuttingLineMm ?? Infinity, length);
          if (length < tinySegmentThresholdMm) result.tinyCuttingLines++;
        }
      }
    }
    position = target;
  }
  result.averageCuttingLineMm = measured ? totalLength / measured : null;
  return result;
}
