import { addConstraint } from './document';
import { dimensionValueError } from './dimensionValues';
import { measureDimension, refreshDimensionMeasurement } from './dimensions';
import { validateCadDocument } from './geometry';
import { solveCadDocument } from './solver';
import type { CadDiagnostic, CadDimension, CadDocument, CadPart, CadSolveResult } from './types';

export type CadDimensionCreationResult =
  | { ok: true; part: CadPart; dimension: CadDimension; driven: boolean }
  | { ok: false; message: string; diagnostics: CadDiagnostic[] };

const documentOf = (part: CadPart): CadDocument => ({
  version: 1,
  id: `dimension-creation:${part.id}`,
  name: part.name,
  revision: 0,
  parts: [part],
});
const nativeState = (result: CadSolveResult) => result.sketches[0];
const failure = (message: string, diagnostics: CadDiagnostic[] = []): CadDimensionCreationResult => ({ ok: false, message, diagnostics });

/**
 * Place a fresh dimension at the measured geometry. A redundant proposal becomes a reference;
 * existing drivers are never reclassified. Later numeric edits remain ordinary driving edits.
 * The returned detached part is one caller-owned history command. Run this operation in a worker.
 */
export async function prepareDimensionCreation(part: CadPart, dimension: CadDimension): Promise<CadDimensionCreationResult> {
  if (
    part.sketch.constraints.some(constraint => constraint.id === dimension.id) ||
    part.sketch.entities.some(entity => entity.id === dimension.id)
  )
    return failure('This dimension identity is already in use.');
  const valueError = dimensionValueError(dimension, dimension.value);
  if (valueError) return failure(valueError);
  const invalid = validateCadDocument(documentOf({ ...part, sketch: addConstraint(part.sketch, dimension) })).filter(
    diagnostic => diagnostic.severity === 'error'
  );
  if (invalid.length) return failure('The proposed dimension references are invalid.', invalid);
  const baseline = await solveCadDocument(documentOf(part));
  const baselineState = nativeState(baseline);
  if (baselineState?.status !== 'solved')
    return failure('Resolve the existing sketch constraints before placing a new dimension.', baseline.diagnostics);
  const base = baseline.document.parts[0]!;
  const value = measureDimension(base.sketch, dimension);
  if (value === null || !Number.isFinite(value)) return failure('The dimension references cannot be measured.');
  const proposal = refreshDimensionMeasurement(base.sketch, { ...dimension, value });
  const measuredError = dimensionValueError(proposal, proposal.value);
  if (measuredError) return failure(measuredError);
  if (proposal.driven) {
    return { ok: true, part: { ...base, sketch: addConstraint(base.sketch, proposal) }, dimension: proposal, driven: true };
  }
  const candidate = await solveCadDocument(documentOf({ ...base, sketch: addConstraint(base.sketch, proposal) }));
  const candidateState = nativeState(candidate);
  if (candidateState?.status !== 'solved')
    return failure('The proposed dimension could not be applied to this sketch.', candidate.diagnostics);
  if (candidateState.dof === baselineState.dof) {
    const reference = refreshDimensionMeasurement(base.sketch, { ...proposal, driven: true });
    return { ok: true, part: { ...base, sketch: addConstraint(base.sketch, reference) }, dimension: reference, driven: true };
  }
  if (candidateState.dof > baselineState.dof)
    return failure('The proposed dimension did not produce a reliable constraint rank.', candidate.diagnostics);
  const solvedPart = candidate.document.parts[0]!;
  const solvedDimension = solvedPart.sketch.constraints.find(constraint => constraint.id === dimension.id)! as CadDimension;
  return { ok: true, part: solvedPart, dimension: solvedDimension, driven: false };
}
