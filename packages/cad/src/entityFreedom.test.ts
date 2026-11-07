import { describe, expect, it } from 'vitest';
import {
  addCircle,
  addConstraint,
  addLine,
  addRectangle,
  createCadDocument,
  createCadPart,
  createPlateDocument,
  originId,
  offsetSketch,
  solveCadDocument,
  type CadSketch,
} from './index';

const docWith = (sketch: CadSketch) => ({ ...createCadDocument(), parts: [{ ...createCadPart(), sketch }] });

describe('native entity freedom analysis', () => {
  it('returns truthful partial unknown colors when the optional measured budget is exhausted', async () => {
    const document = docWith(addLine(createCadPart().sketch, { x1: 10, y1: 10, x2: 40, y2: 20 }));
    const options = { classifyEntities: true, entityAnalysisBudgetMs: 0 };
    const result = await solveCadDocument(document, options);
    expect(result.sketches[0]!.status).toBe('solved');
    expect(result.sketches[0]!.dof).toBe(4);
    expect(result.sketches[0]!.entityAnalysis).toMatchObject({ complete: false, limitedBy: 'budget', probes: 0 });
    expect(result.sketches[0]!.entityStatus![originId(document.parts[0]!.sketch)]).toBe('fully-constrained');
    expect(result.sketches[0]!.entityStatus![document.parts[0]!.sketch.entities.at(-1)!.id]).toBe('unknown');
    expect(result.document).toEqual(document);
    expect(result.diagnostics.some(d => d.code === 'entity-analysis-limited' && d.severity === 'warning')).toBe(true);
  });

  it('keeps zero-DOF classification complete even when no optional probing budget remains', async () => {
    const document = createPlateDocument(),
      options = { classifyEntities: true, entityAnalysisBudgetMs: 0 };
    const result = await solveCadDocument(document, options);
    expect(result.sketches[0]!.entityAnalysis).toMatchObject({ complete: true, probes: 0 });
    expect(Object.values(result.sketches[0]!.entityStatus!).every(status => status === 'fully-constrained')).toBe(true);
    expect(result.diagnostics.some(d => d.code === 'entity-analysis-limited')).toBe(false);
  });

  it('preserves a native-valid free 128-gon Offset when optional classification reaches its resource budget', async () => {
    let sketch = createCadPart().sketch;
    for (let i = 0; i < 128; i++) {
      const at = (j: number) => ({ x: 2000 + 1000 * Math.cos((j * Math.PI) / 64), y: 3000 + 1000 * Math.sin((j * Math.PI) / 64) });
      const a = at(i),
        b = at(i + 1);
      sketch = addLine(sketch, { x1: a.x, y1: a.y, x2: b.x, y2: b.y });
    }
    const offset = offsetSketch(sketch, { entityIds: sketch.entities.filter(e => e.type === 'line').map(e => e.id), value: 2 });
    if (!offset.ok) throw Error(offset.message);
    const document = docWith(offset.sketch),
      input = structuredClone(document);
    const result = await solveCadDocument(document, { classifyEntities: true });
    expect(result.status, JSON.stringify(result.diagnostics)).toBe('solved');
    expect(result.sketches[0]!.dof).toBe(256);
    expect(result.document).toEqual(input);
    expect(result.diagnostics.some(d => d.code === 'solver-restarted' || d.severity === 'error')).toBe(false);
    expect(result.sketches[0]!.entityAnalysis).toMatchObject({ complete: false });
    const next = await solveCadDocument(document);
    expect(next.status).toBe('solved');
    expect(next.document).toEqual(input);
  });
  it('recognizes a constrained bottom edge within a rectangle whose height is still free', async () => {
    let sketch = addRectangle(createCadPart().sketch, { x: 0, y: 0, width: 100, height: 60 });
    const lines = sketch.entities.filter(entity => entity.type === 'line');
    const bottom = lines[0]!;
    sketch = addConstraint(sketch, { type: 'coincident', pointAId: bottom.startId, pointBId: originId(sketch) });
    sketch = addConstraint(sketch, { type: 'distance', pointAId: bottom.startId, pointBId: bottom.endId, value: 100 });
    const document = docWith(sketch),
      baseline = await solveCadDocument(document);
    const result = await solveCadDocument(document, { classifyEntities: true });
    expect(result.document).toEqual(baseline.document);
    expect(result.diagnostics).toEqual(baseline.diagnostics);
    expect(result.sketches[0]!.dof).toBe(1);
    const status = result.sketches[0]!.entityStatus!;
    expect(status[bottom.id]).toBe('fully-constrained');
    expect(status[bottom.startId]).toBe('fully-constrained');
    expect(status[bottom.endId]).toBe('fully-constrained');
    for (const line of lines.slice(1)) expect(status[line.id]).toBe('underconstrained');
  });

  it('keeps dimension-constrained geometry black independently of detached free geometry', async () => {
    const document = createPlateDocument(),
      part = document.parts[0]!;
    const constrained = part.sketch.entities.map(entity => entity.id);
    part.sketch = addLine(part.sketch, { x1: 200, y1: 10, x2: 230, y2: 25 });
    const freeLine = part.sketch.entities.at(-1)!;
    part.sketch = addCircle(part.sketch, { x: 220, y: 100, radius: 10 });
    const freeCircle = part.sketch.entities.at(-1)!;
    const result = await solveCadDocument(document, { classifyEntities: true });
    const status = result.sketches[0]!.entityStatus!;
    expect(result.sketches[0]!.status).toBe('solved');
    for (const id of constrained) expect(status[id]).toBe('fully-constrained');
    expect(status[freeLine.id]).toBe('underconstrained');
    expect(status[freeCircle.id]).toBe('underconstrained');
  });

  it('checks a circle radius independently when its center is fixed', async () => {
    let sketch = addCircle(createCadPart().sketch, { x: 0, y: 0, radius: 10 });
    const circle = sketch.entities.at(-1)!;
    sketch = addLine(sketch, { x1: 50, y1: 10, x2: 80, y2: 30 });
    const free = await solveCadDocument(docWith(sketch), { classifyEntities: true });
    expect(free.sketches[0]!.entityStatus![circle.id]).toBe('underconstrained');
    sketch = addConstraint(sketch, { type: 'radius', entityId: circle.id, value: 10 });
    const fixed = await solveCadDocument(docWith(sketch), { classifyEntities: true });
    expect(fixed.sketches[0]!.dof).toBeGreaterThan(0);
    expect(fixed.sketches[0]!.entityStatus![circle.id]).toBe('fully-constrained');
  });

  it('uses the zero-DOF fast path and keeps classification opt-in', async () => {
    const document = createPlateDocument();
    expect((await solveCadDocument(document)).sketches[0]!.entityStatus).toBeUndefined();
    const result = await solveCadDocument(document, { classifyEntities: true });
    expect(result.sketches[0]!.entityAnalysis?.probes).toBe(0);
    expect(Object.values(result.sketches[0]!.entityStatus!)).toEqual(document.parts[0]!.sketch.entities.map(() => 'fully-constrained'));
  });
});
