import { addCircle, createPlateDocument, dimensionForSelection, updateDimension } from '@wbcnc/cad';
import { afterEach, describe, expect, it } from 'vitest';
import { disposeCadSolver, prepareDimensionCreation, solveCadDocument } from './solveCad';

afterEach(disposeCadSolver);

describe('dedicated CAD solver worker', () => {
  it('loads its local WASM asset and solves dimensions across the worker boundary', async () => {
    const document = createPlateDocument({ width: 100, height: 60 });
    const part = document.parts[0];
    part.sketch = addCircle(part.sketch, { x: 30, y: 30, radius: 5 });
    const width = part.sketch.constraints.find(c => c.label === 'Width')!;
    const next = updateDimension(document, width.id, 140);
    const result = await solveCadDocument(next);
    expect(result.status).toBe('solved');
    expect(result.document.revision).toBe(next.revision);
    expect(result.parts[0].holes).toHaveLength(1);
    expect(Math.max(...result.parts[0].outline.map(p => p.x))).toBeCloseTo(140, 7);
    expect(Math.max(...document.parts[0].sketch.entities.filter(e => e.type === 'point').map(p => p.x))).toBe(100);
  });

  it('keeps simultaneous revision results detached so clients can discard obsolete responses', async () => {
    const document = createPlateDocument();
    const width = document.parts[0].sketch.constraints.find(c => c.label === 'Width')!;
    const first = updateDimension(document, width.id, 140);
    const second = updateDimension(first, width.id, 160);
    const results = await Promise.all([solveCadDocument(first), solveCadDocument(second)]);
    expect(results.map(result => result.document.revision)).toEqual([1, 2]);
    expect(results.map(result => Math.max(...result.parts[0].outline.map(p => p.x)))).toEqual([140, 160]);
  });

  it('settles in-flight calls when disposed and creates a new solver for later work', async () => {
    const pending = solveCadDocument(createPlateDocument());
    disposeCadSolver();
    await expect(pending).rejects.toThrow('closed');
    expect((await solveCadDocument(createPlateDocument())).status).toBe('solved');
  });

  it('classifies a fresh redundant dimension in the worker without changing its source part', async () => {
    const part = createPlateDocument({ width: 100, height: 60 }).parts[0]!;
    const top = part.sketch.entities.filter(entity => entity.type === 'line')[2]!;
    const proposal = dimensionForSelection(part.sketch, [top.id]);
    if ('message' in proposal) throw new Error(proposal.message);
    const source = structuredClone(part);
    const result = await prepareDimensionCreation(part, {
      ...proposal.constraint,
      id: 'new-top-reference',
      labelPosition: { x: 50, y: 80 },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.driven).toBe(true);
    expect(result.dimension).toMatchObject({ id: 'new-top-reference', driven: true, value: 100, labelPosition: { x: 50, y: 80 } });
    expect(part).toEqual(source);
    expect(result.part.sketch.constraints.filter(c => c.id !== 'new-top-reference')).toEqual(part.sketch.constraints);
  });
});
