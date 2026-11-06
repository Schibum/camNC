import { readFileSync } from 'node:fs';
import { readGcode } from '../../../src/analyze';
import { programStatistics } from '../../../src/programStatistics';
import { estimateProgramTime, LOWRIDER_V4_REFERENCE_PROFILE } from '../../../src/timing';
import { DEFAULT_SETTINGS } from '../../../src/toolpaths';
import { generateMachiningCase, sha256, type MachiningCaseInput } from '../build';

export const PERFORMANCE_INPUT_TEXT = readFileSync(new URL('./cases.json', import.meta.url), 'utf8');
export const performanceCases = JSON.parse(PERFORMANCE_INPUT_TEXT) as MachiningCaseInput[];
export interface PerformanceLimits {
  executableBlocks: number;
  tinyFeedLineBlocks: number;
  retracts: number;
  estimatedAutomaticSeconds: number;
}
export const performanceLimits = JSON.parse(readFileSync(new URL('./limits.json', import.meta.url), 'utf8')) as Record<
  string,
  PerformanceLimits
>;

/** Deterministic output/work estimates, never host wall time or measured machining time. */
export function measurePerformanceCase(input: MachiningCaseInput) {
  const result = generateMachiningCase(input);
  const metrics = result.programs.map(program => {
    const statistics = programStatistics(program.gcode);
    const moves = readGcode(program.gcode);
    const timing = estimateProgramTime(program.gcode, LOWRIDER_V4_REFERENCE_PROFILE);
    return {
      file: program.file,
      sha256: sha256(program.gcode),
      bytes: statistics.bytes,
      executableBlocks: statistics.executableBlocks,
      motionBlocks: statistics.motionBlocks,
      tinyFeedLineBlocks: statistics.tinyCuttingLines,
      feedLineBlocks: statistics.cuttingLineBlocks,
      retracts: moves.filter(move => move.rapid && move.to[2] > move.from[2] + 1e-6).length,
      estimatedAutomaticSeconds: +timing.estimatedAutomaticSeconds.toFixed(3),
      motionLowerBoundSeconds: +timing.motionLowerBoundSeconds.toFixed(3),
      fullStopAutomaticSeconds: +timing.fullStopAutomaticSeconds.toFixed(3),
      timingSkippedMotionCount: timing.skippedMotionCount,
      timingUncertainty: timing.uncertainty,
    };
  });
  return { input, resolvedSettings: { ...DEFAULT_SETTINGS, ...input.settings }, result, metrics };
}
