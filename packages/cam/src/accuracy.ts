import { PRECISION } from './geom';

export interface AccuracyBudget {
  /** Maximum combined geometric deviation, mm. Intentional stock allowance is separate. */
  total: number;
  /** Caller-declared source geometry uncertainty; zero does not certify the original CAD import. */
  import: number;
  offset: number;
  smoothing: number;
  fitting: number;
  polygonRounding: number;
  outputRounding: number;
  /** Float32 XYZ representation within the supported absolute-coordinate domain of 4096 mm. */
  controllerRounding: number;
}

/** Reserve quantization first, then share the remaining error between geometry stages. */
export function accuracyBudget(total = 0.05, outputDecimals = 3, sourceTolerance = 0): AccuracyBudget {
  if (!Number.isFinite(total) || total <= 0) throw new Error('Geometry tolerance must be positive and finite');
  if (!Number.isInteger(outputDecimals) || outputDecimals < 0 || outputDecimals > 8)
    throw new Error('Coordinate precision must be an integer from 0 to 8');
  if (!Number.isFinite(sourceTolerance) || sourceTolerance < 0) throw new Error('Source geometry tolerance must be nonnegative and finite');
  const outputRounding = (Math.sqrt(3) / 2) * 10 ** -outputDecimals;
  const controllerRounding = Math.sqrt(3) * 2 ** -10;
  // Reserve the bounded sequence of clipping/offset/cleanup operations after feature extraction.
  const polygonRounding = 32 * (Math.sqrt(2) / 2) * 10 ** -PRECISION;
  const available = total - outputRounding - controllerRounding - polygonRounding - sourceTolerance;
  if (available <= 0) throw new Error('Geometry tolerance is smaller than the coordinate quantization budget');
  if (available * 0.75 < 0.001) throw new Error('Geometry tolerance cannot reserve the minimum 0.001 mm fitting allowance');
  return {
    total,
    import: sourceTolerance,
    // Arc substitution must cover the source chords as well as their vertices.
    // Tighten intermediate geometry so this fitting reserve still fits the same job total.
    offset: available * 0.1,
    smoothing: available * 0.15,
    fitting: available * 0.75,
    polygonRounding,
    outputRounding,
    controllerRounding,
  };
}

export interface PlanAccuracy {
  /** Source scope includes only the explicitly supplied uncertainty, not an independently verified import bound. */
  scope: 'features' | 'declared-source';
  budget: AccuracyBudget;
}

export function planAccuracy(total = 0.05, sourceTolerance?: number): PlanAccuracy {
  return { scope: sourceTolerance === undefined ? 'features' : 'declared-source', budget: accuracyBudget(total, 3, sourceTolerance ?? 0) };
}

/** Share stage limits across extension, rest-region cleanup and final boundary generation. */
export function geometryTolerances(total = 0.05, sourceTolerance?: number) {
  const { budget } = planAccuracy(total, sourceTolerance);
  return {
    offset: Math.min(0.005, budget.offset / 8),
    cleanup: budget.smoothing / 96,
    simplify: budget.smoothing / 48,
    opening: Math.min(0.002, budget.smoothing / 8),
    lead: Math.min(0.005, budget.smoothing / 4),
  };
}

/** Check resolved stage limits rather than treating independent tolerances as one accuracy guarantee. */
export function checkAccuracyBudget(budget: AccuracyBudget): void {
  const { total, ...stages } = budget;
  if (!Number.isFinite(total) || total <= 0 || Object.values(stages).some(value => !Number.isFinite(value) || value < 0))
    throw new Error('Invalid geometry accuracy budget');
  if (Object.values(stages).reduce((sum, value) => sum + value, 0) > total + 1e-12)
    throw new Error('Geometry stage tolerances exceed the job tolerance');
}
