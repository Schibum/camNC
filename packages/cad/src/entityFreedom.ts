import { Algorithm, Constraint_Alignment, DebugMode, GcsWrapper, SolveStatus } from '@salusoft89/planegcs';
import { entityPointIds } from './document';
import type { CadEntityFreedom, CadSketch } from './types';
import { isFatalSolverError } from './solverFailure';

export const DEFAULT_ENTITY_ANALYSIS_BUDGET_MS = 100;
export interface EntityAnalysisOptions {
  budgetMs?: number;
  /** Already consumed primary native solve time, charged against optional analysis work. */
  spentMs?: number;
  /** Runtime abort hooks may fire before a binding throws a generic JavaScript error. */
  isAborted?: () => boolean;
}

/** Query native Jacobian rank at the accepted solution without publishing or perturbing geometry. */
export function classifyNativeEntities(
  sketch: CadSketch,
  wrapper: GcsWrapper,
  options: EntityAnalysisOptions = {}
): { status: Record<string, CadEntityFreedom>; elapsedMs: number; probes: number; complete: boolean; limitedBy?: 'budget' | 'failure' } {
  const started = performance.now(),
    baseline = wrapper.gcs.dof();
  const status: Record<string, CadEntityFreedom> = {};
  let probes = 0;
  if (baseline === 0) {
    for (const entity of sketch.entities) status[entity.id] = 'fully-constrained';
    return { status, elapsedMs: performance.now() - started, probes, complete: true };
  }
  const requestedBudget = options.budgetMs ?? DEFAULT_ENTITY_ANALYSIS_BUDGET_MS;
  const budgetMs = Number.isFinite(requestedBudget) ? Math.max(0, requestedBudget) : 0;
  const spentMs = Number.isFinite(options.spentMs) ? Math.max(0, options.spentMs!) : 0;
  let limitedBy: 'budget' | 'failure' | undefined;
  const tag = wrapper.sketch_index.counter() + 1;
  const previousDebug = wrapper.debug_mode;
  const scratch: number[] = [];
  let fatalFailure = false;
  wrapper.debug_mode = DebugMode.NoDebug;
  const pointParams = (id: string): number[] | undefined => {
    const index = wrapper.p_param_index.get(id);
    return index === undefined ? undefined : [index, index + 1];
  };
  const query = (indices: number[]): CadEntityFreedom => {
    const params = [...new Set(indices)].filter(index => !wrapper.gcs.get_is_fixed(index));
    if (!params.length) return 'fully-constrained';
    if (spentMs + performance.now() - started >= budgetMs) {
      limitedBy = 'budget';
      return 'unknown';
    }
    probes++;
    try {
      for (const [slot, index] of params.entries()) {
        let constant = scratch[slot];
        if (constant === undefined) {
          constant = wrapper.gcs.push_p_param(wrapper.gcs.get_p_param(index), true);
          scratch.push(constant);
        } else wrapper.gcs.set_p_param(constant, wrapper.gcs.get_p_param(index), true);
        wrapper.gcs.add_constraint_equal(index, constant, tag, true, Constraint_Alignment.NoInternalAlignment, 1);
      }
      const solved = wrapper.solve(Algorithm.DogLeg);
      if (options.isAborted?.()) throw new WebAssembly.RuntimeError('The native analysis engine aborted.');
      if (solved !== SolveStatus.Success) {
        limitedBy ??= 'failure';
        return 'unknown';
      }
      const remaining = wrapper.gcs.dof();
      return remaining === baseline ? 'fully-constrained' : remaining < baseline ? 'underconstrained' : 'unknown';
    } catch (error) {
      if (isFatalSolverError(error) || options.isAborted?.()) {
        fatalFailure = true;
        throw error;
      }
      limitedBy ??= 'failure';
      return 'unknown';
    } finally {
      if (!fatalFailure && !options.isAborted?.()) wrapper.gcs.clear_by_id(tag);
    }
  };
  try {
    // The rank of a curve's point coordinates is already known after classifying its points.
    for (const point of sketch.entities.filter(entity => entity.type === 'point')) {
      const params = pointParams(point.id);
      status[point.id] = params ? query(params) : 'unknown';
      if (!params) limitedBy ??= 'failure';
    }
    for (const entity of sketch.entities) {
      if (entity.type === 'point') continue;
      const pointStatus = entityPointIds(entity).map(id => status[id]);
      if (pointStatus.includes('underconstrained')) status[entity.id] = 'underconstrained';
      else if (pointStatus.some(value => value !== 'fully-constrained')) status[entity.id] = 'unknown';
      else if (entity.type === 'circle' || entity.type === 'arc') {
        const index = wrapper.p_param_index.get(entity.id);
        status[entity.id] = index === undefined ? 'unknown' : query(entity.type === 'circle' ? [index] : [index, index + 1, index + 2]);
        if (index === undefined) limitedBy ??= 'failure';
      } else status[entity.id] = 'fully-constrained';
    }
    // No caller may accidentally observe the final probe's reduced degree count or diagnosis.
    if (probes) {
      try {
        if (wrapper.solve(Algorithm.DogLeg) !== SolveStatus.Success) limitedBy ??= 'failure';
        if (options.isAborted?.()) throw new WebAssembly.RuntimeError('The native analysis engine aborted.');
      } catch (error) {
        if (isFatalSolverError(error) || options.isAborted?.()) fatalFailure = true;
        throw error;
      }
    }
    return { status, elapsedMs: performance.now() - started, probes, complete: !limitedBy, ...(limitedBy && { limitedBy }) };
  } finally {
    if (!fatalFailure && !options.isAborted?.()) {
      wrapper.gcs.clear_by_id(tag);
      wrapper.debug_mode = previousDebug;
    }
  }
}
