import { addConstraint, addLine, createCadDocument, createCadPart, solveCadDocument } from '@wbcnc/cad';
import { describe, expect, it } from 'vitest';
import { constraintColorNotice, sketchFeedback } from './sketchFeedback';

describe('feedback while sketching', () => {
  it('explains limited constraint colors without treating validated geometry as an error', () => {
    const status = { partId: 'part', dof: 4, status: 'solved' as const };
    expect(constraintColorNotice(status)).toBeUndefined();
    expect(constraintColorNotice({ ...status, entityAnalysis: { elapsedMs: 1, probes: 0, complete: false, limitedBy: 'budget' } })).toBe(
      'Sketch solved; some constraint colors unavailable'
    );
    expect(
      constraintColorNotice({ ...status, entityAnalysis: { elapsedMs: 1, probes: -1, complete: false, limitedBy: 'engine-reset' } })
    ).toBe('Sketch solved; constraint color analysis reset');
    expect(
      constraintColorNotice({ ...status, status: 'invalid', entityAnalysis: { elapsedMs: 1, probes: -1, complete: false } })
    ).toBeUndefined();
  });
  it('distinguishes an engine reset from conflicting geometry and keeps the retry message visible', () => {
    const document = createCadDocument();
    const part = createCadPart();
    document.parts.push(part);
    const message = 'The sketch solver stopped and its engine was reset. Your sketch is unchanged; try the edit again.';
    expect(
      sketchFeedback({
        document,
        status: 'invalid',
        parts: [],
        diagnostics: [{ code: 'solver-restarted', severity: 'error', message }],
        sketches: [{ partId: part.id, dof: -1, status: 'invalid' }],
      })
    ).toMatchObject({ inProgress: false, status: 'Sketch solver reset', problems: [message], conflictedConstraintIds: [] });
  });

  it('treats an empty sketch and an open chain as normal work in progress with meaningful DOF', async () => {
    const document = createCadDocument();
    const part = createCadPart();
    document.parts.push(part);
    expect(sketchFeedback(await solveCadDocument(document))).toMatchObject({ inProgress: true, status: 'Empty sketch' });
    part.sketch = addLine(part.sketch, { x1: 10, y1: 10, x2: 40, y2: 20 });
    const feedback = sketchFeedback(await solveCadDocument(document));
    expect(feedback.inProgress).toBe(true);
    expect(feedback.status).toBe('4 degrees of freedom');
    expect(feedback.problems).toHaveLength(1);
  });

  it('retains errors for conflicting dimensions instead of hiding them as an unfinished outline', async () => {
    const document = createCadDocument();
    const part = createCadPart();
    part.sketch = addLine(part.sketch, { x1: 10, y1: 10, x2: 40, y2: 10 });
    const line = part.sketch.entities.find(e => e.type === 'line')!;
    part.sketch = addConstraint(part.sketch, { type: 'horizontal', entityId: line.id });
    part.sketch = addConstraint(part.sketch, { type: 'distanceY', pointAId: line.startId, pointBId: line.endId, value: 10 });
    document.parts.push(part);
    expect(sketchFeedback(await solveCadDocument(document))).toMatchObject({ inProgress: false, status: 'Conflicting constraints' });
  });

  it('colors errors as conflicts while leaving redundant-relation warnings neutral', async () => {
    const document = createCadDocument();
    document.parts.push(createCadPart());
    const result = await solveCadDocument(document);
    result.diagnostics = [
      { code: 'redundant-constraint', severity: 'warning', message: 'Redundant tangent', constraintIds: ['tangent'] },
      { code: 'constraint-conflict', severity: 'error', message: 'Conflicting size', constraintIds: ['size'] },
    ];
    expect(sketchFeedback(result)).toMatchObject({ conflictedConstraintIds: ['size'], problems: ['Conflicting size'] });
  });
});
