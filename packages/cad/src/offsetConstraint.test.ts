import { describe, expect, it } from 'vitest';
import { offsetNativePrimitives } from './offsetConstraint';
import {
  addArc,
  addCircle,
  addConstraint,
  addLine,
  addRectangle,
  createCadDocument,
  createCadPart,
  createPlateDocument,
  dimensionValueError,
  offsetSketch,
  dimensionWitnessPoints,
  measureDimension,
  parseCadDocument,
  removeConstraint,
  removeEntity,
  solveCadDocument,
  updateDimension,
  type CadConstraint,
  type CadPointEntity,
  type CadSketch,
} from './index';

const documentOf = (sketch: CadSketch) => ({ ...createCadDocument(), parts: [{ ...createCadPart(), sketch }] });
const freeze = (sketch: CadSketch): CadSketch => ({
  ...sketch,
  entities: sketch.entities.map(e => (e.type === 'point' ? { ...e, fixed: true } : e)),
});
const points = (sketch: CadSketch) => new Map(sketch.entities.filter((e): e is CadPointEntity => e.type === 'point').map(p => [p.id, p]));
async function solve(sketch: CadSketch, id: string, value: number) {
  const result = await solveCadDocument(updateDimension(documentOf(sketch), id, value));
  expect(result.sketches[0]!.status, JSON.stringify(result.diagnostics)).toBe('solved');
  return result;
}

describe('one native signed Offset driver', () => {
  it.each([8, -2])('edits a free 50×30 rectangle Offset2→%s without moving any source vertex', async value => {
    const sketch = addRectangle(createCadPart().sketch, { x: 10, y: 20, width: 50, height: 30 });
    const sourceIds = new Set(sketch.entities.map(e => e.id));
    const command = offsetSketch(sketch, { entityIds: sketch.entities.filter(e => e.type === 'line').map(e => e.id), value: 2 });
    if (!command.ok) throw Error(command.message);
    const initial = await solveCadDocument(documentOf(command.sketch));
    expect(initial.sketches[0]!.status).toBe('solved');
    expect(initial.sketches[0]!.dof).toBe(4);
    const before = initial.document.parts[0]!.sketch;
    const edited = await solveCadDocument(updateDimension(initial.document, command.dimensionId, value));
    expect(edited.sketches[0]!.status, JSON.stringify(edited.diagnostics)).toBe('solved');
    const output = edited.document.parts[0]!.sketch;
    for (const point of before.entities.filter((e): e is CadPointEntity => e.type === 'point' && sourceIds.has(e.id))) {
      expect(points(output).get(point.id)!.x).toBeCloseTo(point.x, 8);
      expect(points(output).get(point.id)!.y).toBeCloseTo(point.y, 8);
    }
    expect(edited.sketches[0]!.dof).toBe(4);
    expect(output.constraints).toEqual(updateDimension(initial.document, command.dimensionId, value).parts[0]!.sketch.constraints);
  });

  it('warms a tilted isolated finite line copy while retaining its four source freedoms', async () => {
    const sketch = addLine(createCadPart().sketch, { x1: 10, y1: 20, x2: 60, y2: 50 });
    const sourceId = sketch.entities.at(-1)!.id;
    const command = offsetSketch(sketch, { entityIds: [sourceId], value: 2 });
    if (!command.ok) throw Error(command.message);
    const initial = await solveCadDocument(documentOf(command.sketch));
    let document = initial.document;
    const original = new Map(points(document.parts[0]!.sketch));
    const source = sketch.entities.find(e => e.id === sourceId)!;
    if (source.type !== 'line') throw Error();
    for (const value of [8, -2, 5]) {
      const result = await solveCadDocument(updateDimension(document, command.dimensionId, value));
      expect(result.sketches[0]!.status, JSON.stringify(result.diagnostics)).toBe('solved');
      expect(result.sketches[0]!.dof).toBe(4);
      for (const id of [source.startId, source.endId]) {
        const actual = points(result.document.parts[0]!.sketch).get(id)!,
          expected = original.get(id)!;
        expect(actual.x).toBeCloseTo(expected.x, 8);
        expect(actual.y).toBeCloseTo(expected.y, 8);
      }
      document = result.document;
    }
  });

  it('rejects an oversized free-loop edit instead of growing its free source to accommodate the gap', async () => {
    const sketch = addRectangle(createCadPart().sketch, { x: 10, y: 20, width: 50, height: 30 });
    const command = offsetSketch(sketch, { entityIds: sketch.entities.filter(e => e.type === 'line').map(e => e.id), value: 2 });
    if (!command.ok) throw Error(command.message);
    const initial = await solveCadDocument(documentOf(command.sketch));
    const input = updateDimension(initial.document, command.dimensionId, 20),
      result = await solveCadDocument(input);
    expect(result.sketches[0]!.status).toBe('invalid');
    expect(result.document).toEqual(input);
    expect(result.diagnostics.some(d => d.code === 'invalid-offset' && d.constraintIds?.includes(command.dimensionId))).toBe(true);
  });
  it('rejects a later oversized loop edit rather than publishing a reversed inner contour', async () => {
    const document = createPlateDocument({ width: 120, height: 80 });
    const source = document.parts[0]!.sketch;
    const offset = offsetSketch(source, { entityIds: source.entities.filter(e => e.type === 'line').map(e => e.id), value: 12 });
    if (!offset.ok) throw Error(offset.message);
    document.parts[0]!.sketch = offset.sketch;
    const initial = await solveCadDocument(document);
    expect(initial.sketches[0]!.status).toBe('solved');
    const input = updateDimension(initial.document, offset.dimensionId, 50);
    const invalid = await solveCadDocument(input);
    expect(invalid.sketches[0]!.status).toBe('invalid');
    expect(invalid.document).toEqual(input);
    expect(invalid.diagnostics.some(d => d.constraintIds?.includes(offset.dimensionId) && d.severity === 'error')).toBe(true);
  });
  it('switches finite line side and retains both longitudinal endpoint positions', async () => {
    let sketch = freeze(addLine(createCadPart().sketch, { x1: 10, y1: 20, x2: 40, y2: 30 }));
    const source = sketch.entities.at(-1)!;
    const nx = -10 / Math.sqrt(1000),
      ny = 30 / Math.sqrt(1000);
    sketch = addLine(sketch, { x1: 10 + nx * 5, y1: 20 + ny * 5, x2: 40 + nx * 5, y2: 30 + ny * 5 });
    const target = sketch.entities.at(-1)!;
    sketch = addConstraint(sketch, {
      type: 'offset',
      value: 5,
      members: [{ kind: 'line', sourceId: source.id, targetId: target.id, side: 1, endpoints: true }],
    });
    const id = sketch.constraints.at(-1)!.id;
    const result = await solve(sketch, id, -8),
      output = result.document.parts[0]!.sketch;
    expect(result.sketches[0]!.dof).toBe(0);
    if (target.type !== 'line') throw Error();
    expect(points(output).get(target.startId)!.x).toBeCloseTo(10 - nx * 8, 6);
    expect(points(output).get(target.endId)!.y).toBeCloseTo(30 - ny * 8, 6);
    const dimension = output.constraints.find(c => c.id === id)! as Extract<CadConstraint, { type: 'offset' }>;
    expect(measureDimension(output, dimension)).toBeCloseTo(-8, 6);
    expect(dimensionWitnessPoints(output, dimension)).toHaveLength(2);
    expect(parseCadDocument(JSON.parse(JSON.stringify(result.document)))).toEqual(result.document);
    const released = await solveCadDocument(documentOf(removeConstraint(output, id)));
    expect(released.sketches[0]!.dof).toBe(4);
    expect(removeEntity(output, source.id).constraints.some(c => c.id === id)).toBe(false);
  });

  it.each(['circle', 'arc'] as const)('links %s radius difference across both value signs and later source edits', async kind => {
    let sketch =
      kind === 'circle'
        ? addCircle(createCadPart().sketch, { x: 30, y: 40, radius: 10 })
        : addArc(createCadPart().sketch, { cx: 30, cy: 40, radius: 10, startAngle: 0.4, endAngle: 3.1 });
    const source = sketch.entities.at(-1)!;
    if (source.type !== 'arc' && source.type !== 'circle') throw Error();
    sketch = {
      ...sketch,
      entities: sketch.entities.map(e => (e.id === source.centerId && e.type === 'point' ? { ...e, fixed: true } : e)),
    };
    sketch = addConstraint(sketch, { type: 'radius', entityId: source.id, value: 10 });
    const radiusId = sketch.constraints.at(-1)!.id;
    if (source.type === 'arc') {
      const start = points(sketch).get(source.startId)!;
      sketch = addConstraint(sketch, { type: 'positionY', pointId: start.id, value: start.y });
      const end = points(sketch).get(source.endId)!;
      sketch = addConstraint(sketch, { type: 'positionY', pointId: end.id, value: end.y });
    }
    // Separate center IDs are intentional: concentricity belongs to the offset group.
    const centerId = crypto.randomUUID();
    const target =
      source.type === 'circle'
        ? { ...source, id: crypto.randomUUID(), centerId, radius: 15 }
        : { ...source, id: crypto.randomUUID(), centerId, startId: crypto.randomUUID(), endId: crypto.randomUUID(), radius: 15 };
    sketch.entities.push({ id: centerId, type: 'point', x: 30, y: 40 });
    if (target.type === 'arc')
      for (const [id, angle] of [
        [target.startId, target.startAngle],
        [target.endId, target.endAngle],
      ] as const)
        sketch.entities.push({ id, type: 'point', x: 30 + 15 * Math.cos(angle), y: 40 + 15 * Math.sin(angle) });
    sketch.entities.push(target);
    sketch = addConstraint(sketch, {
      type: 'offset',
      value: 5,
      members: [
        { kind, sourceId: source.id, targetId: target.id, side: 1, ...(kind === 'arc' ? { endpoints: true } : {}) } as Extract<
          CadConstraint,
          { type: 'offset' }
        >['members'][number],
      ],
    });
    const id = sketch.constraints.at(-1)!.id;
    const first = await solve(sketch, id, -3),
      changed = updateDimension(first.document, radiusId, 12);
    const result = await solveCadDocument(changed);
    expect(result.sketches[0]!.status, JSON.stringify(result.diagnostics)).toBe('solved');
    const copy = result.document.parts[0]!.sketch.entities.find(e => e.id === target.id)!;
    if (copy.type !== 'circle' && copy.type !== 'arc') throw Error();
    expect(copy.radius).toBeCloseTo(9, 6);
    if (copy.type === 'arc') {
      const original = result.document.parts[0]!.sketch.entities.find(e => e.id === source.id)!;
      if (original.type !== 'arc') throw Error();
      expect(copy.startAngle).toBeCloseTo(original.startAngle, 6);
      expect(copy.endAngle).toBeCloseTo(original.endAngle, 6);
    }
  });

  it('rejects zero offset and malformed serialized ownership instead of throwing in the compiler', () => {
    expect(dimensionValueError({ type: 'offset' }, 0)).toMatch(/zero/);
    expect(dimensionValueError({ type: 'offset' }, -5)).toBeNull();
    expect(dimensionValueError({ type: 'offset', driven: true }, 0)).toBeNull();
    const doc = documentOf(createCadPart().sketch);
    doc.parts[0]!.sketch.constraints.push({ id: 'bad', type: 'offset', value: 5, members: null } as unknown as CadConstraint);
    expect(() => parseCadDocument(doc)).toThrow();
  });

  it('does not turn a merely tangent free source into a permanent tangent driver', () => {
    let sketch = addLine(createCadPart().sketch, { x1: 20, y1: 0, x2: 100, y2: 0 });
    const sourceLine = sketch.entities.at(-1)!;
    sketch = addArc(sketch, { cx: 100, cy: 20, radius: 20, startAngle: -Math.PI / 2, endAngle: Math.PI / 2 });
    const sourceArc = sketch.entities.at(-1)!;
    sketch = addLine(sketch, { x1: 20, y1: 5, x2: 100, y2: 5 });
    const targetLine = sketch.entities.at(-1)!;
    sketch = addArc(sketch, { cx: 100, cy: 20, radius: 15, startAngle: -Math.PI / 2, endAngle: Math.PI / 2 });
    const targetArc = sketch.entities.at(-1)!;
    const constraint: Extract<CadConstraint, { type: 'offset' }> = {
      id: 'group',
      type: 'offset',
      value: 5,
      members: [
        { kind: 'line', sourceId: sourceLine.id, targetId: targetLine.id, side: 1, endpoints: false },
        { kind: 'arc', sourceId: sourceArc.id, targetId: targetArc.id, side: -1, endpoints: false },
      ],
    };
    const entities = new Map(sketch.entities.map(e => [e.id, e]));
    expect(offsetNativePrimitives(constraint, entities, []).some(p => p.type === 'angle_via_point')).toBe(false);
    sketch = addConstraint(sketch, { type: 'tangent', entityAId: sourceLine.id, entityBId: sourceArc.id });
    expect(offsetNativePrimitives(constraint, entities, sketch.constraints).filter(p => p.type === 'angle_via_point')).toHaveLength(1);
  });

  it('checks fully fixed line copies but leaves a fixed-center circle radius free', async () => {
    let sketch = freeze(addLine(createCadPart().sketch, { x1: 10, y1: 20, x2: 40, y2: 20 }));
    const source = sketch.entities.at(-1)!;
    sketch = freeze(addLine(sketch, { x1: 10, y1: 25, x2: 40, y2: 25 }));
    const target = sketch.entities.at(-1)!;
    sketch = addConstraint(sketch, {
      type: 'offset',
      value: 5,
      members: [{ kind: 'line', sourceId: source.id, targetId: target.id, side: 1, endpoints: true }],
    });
    const id = sketch.constraints.at(-1)!.id;
    expect((await solveCadDocument(documentOf(sketch))).sketches[0]!.status).toBe('solved');
    const failed = await solveCadDocument(updateDimension(documentOf(sketch), id, 8));
    expect(failed.sketches[0]!.status).toBe('conflict');
    expect(failed.diagnostics.some(d => d.constraintIds?.includes(id))).toBe(true);
    let circles = addCircle(createCadPart().sketch, { x: 20, y: 20, radius: 10 });
    const a = circles.entities.at(-1)!;
    // Do not deduplicate centers in this controlled compilation fixture.
    const centerId = crypto.randomUUID(),
      b = { id: crypto.randomUUID(), type: 'circle' as const, centerId, radius: 15 };
    circles.entities.push({ id: centerId, type: 'point', fixed: true, x: 20, y: 20 }, b);
    circles = addConstraint(freeze(circles), { type: 'radius', entityId: a.id, value: 10 });
    circles = addConstraint(circles, { type: 'offset', value: 5, members: [{ kind: 'circle', sourceId: a.id, targetId: b.id, side: 1 }] });
    const solved = await solve(circles, circles.constraints.at(-1)!.id, 8);
    expect(solved.document.parts[0]!.sketch.entities.find(e => e.id === b.id)).toMatchObject({ radius: 18 });
  });
});
