import type { CadSketchSolveStatus, CadSolveResult } from '@wbcnc/cad';

export function constraintColorNotice(status?: CadSketchSolveStatus): string | undefined {
  if (status?.status !== 'solved' || status.entityAnalysis?.complete !== false) return;
  return status.entityAnalysis.limitedBy === 'engine-reset'
    ? 'Sketch solved; constraint color analysis reset'
    : 'Sketch solved; some constraint colors unavailable';
}

/** An open wire is normal while sketching; conflicting constraints and bad geometry are errors. */
export function sketchFeedback(result: CadSolveResult) {
  const issues = result.diagnostics.filter(d => d.severity === 'error');
  const nativeSolved = result.sketches.length > 0 && result.sketches.every(s => s.status === 'solved');
  const inProgress = nativeSolved && issues.length > 0 && issues.every(d => d.code === 'open-profile' || d.code === 'empty-sketch');
  const free = result.sketches.reduce((sum, s) => sum + s.dof, 0);
  const empty = !result.document.parts.some(p => p.sketch.entities.some(e => e.type !== 'point' && !e.construction));
  const status = issues.some(issue => issue.code === 'solver-restarted')
    ? 'Sketch solver reset'
    : result.status === 'conflict'
      ? 'Conflicting constraints'
      : result.status === 'invalid' && !inProgress
        ? 'Sketch needs attention'
        : sketchDofStatus(free, empty);
  return {
    status,
    inProgress,
    problems: [...new Set(issues.map(d => d.message))],
    conflictedConstraintIds: [...new Set(issues.flatMap(d => d.constraintIds ?? []))],
  };
}

export function sketchDofStatus(dof: number, empty: boolean): string {
  return empty ? 'Empty sketch' : dof ? `${dof} ${dof === 1 ? 'degree' : 'degrees'} of freedom` : 'Fully constrained';
}
