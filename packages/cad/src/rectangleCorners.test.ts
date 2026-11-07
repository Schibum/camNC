import { describe, expect, it } from 'vitest';
import { rectangleCorners } from './rectangleCorners';
import {
  addConstraint,
  createCadDocument,
  createCadPart,
  newCadId,
  originId,
  parseCadDocument,
  removeConstraint,
  removeEntity,
  solveCadDocument,
} from './index';
import type { CadConstraint, CadPoint, CadPointEntity } from './types';

const corners = (x = 20, y = 10): [CadPoint, CadPoint, CadPoint, CadPoint] => [
  { x, y },
  { x: x + 40, y },
  { x: x + 40, y: y + 30 },
  { x, y: y + 30 },
];

function fixture({ dimensioned = false, anchorOrigin = false } = {}) {
  const part = createCadPart();
  const graph = rectangleCorners(corners(anchorOrigin ? 0 : 20, anchorOrigin ? 0 : 10), { createId: newCadId });
  const [bottom, right, top, left] = graph.edges;
  part.sketch = {
    ...part.sketch,
    entities: [...part.sketch.entities, ...graph.entities],
    constraints: [
      ...graph.coincidences,
      { id: newCadId(), type: 'horizontal', entityId: bottom.id },
      { id: newCadId(), type: 'parallel', entityAId: bottom.id, entityBId: top.id },
      { id: newCadId(), type: 'parallel', entityAId: right.id, entityBId: left.id },
      { id: newCadId(), type: 'perpendicular', entityAId: bottom.id, entityBId: right.id },
    ],
  };
  if (dimensioned) {
    part.sketch = addConstraint(part.sketch, {
      type: 'distanceX',
      pointAId: bottom.startId,
      pointBId: bottom.endId,
      value: 40,
      sourceEntityId: bottom.id,
      label: 'Width',
    });
    part.sketch = addConstraint(part.sketch, {
      type: 'distanceY',
      pointAId: right.startId,
      pointBId: right.endId,
      value: 30,
      sourceEntityId: right.id,
      label: 'Height',
    });
  }
  if (anchorOrigin)
    part.sketch = addConstraint(part.sketch, { type: 'coincident', pointAId: bottom.startId, pointBId: originId(part.sketch) });
  return { document: { ...createCadDocument(), parts: [part] }, graph };
}

describe('explicit rectangle corner graph', () => {
  it('allocates eight edge-owned endpoints and four removable corner joins in traversal order', () => {
    let sequence = 0;
    const input = corners(0, 0);
    const before = structuredClone(input);
    const graph = rectangleCorners(input, { createId: () => `rectangle-${sequence++}` });
    const points = graph.entities.filter((entity): entity is CadPointEntity => entity.type === 'point');
    expect(points).toHaveLength(8);
    expect(graph.edges).toHaveLength(4);
    expect(new Set(graph.edges.flatMap(edge => [edge.startId, edge.endId])).size).toBe(8);
    expect(new Set([...graph.entities, ...graph.coincidences].map(item => item.id)).size).toBe(16);
    const lookup = new Map(points.map(point => [point.id, point]));
    graph.edges.forEach((edge, index) => {
      expect(lookup.get(edge.startId)).toMatchObject(input[index]!);
      expect(lookup.get(edge.endId)).toMatchObject(input[(index + 1) % 4]!);
      expect(graph.cornerPairs[index]).toEqual({ incomingId: graph.edges[(index + 3) % 4]!.endId, outgoingId: edge.startId });
      expect(graph.coincidences[index]).toMatchObject({
        type: 'coincident',
        pointAId: graph.cornerPairs[index]!.incomingId,
        pointBId: edge.startId,
      });
      expect(lookup.get(graph.cornerPairs[index]!.incomingId)).toMatchObject(input[index]!);
    });
    expect(input).toEqual(before);
    expect(points.every(point => !point.fixed && !point.standalone)).toBe(true);
  });

  it.each([undefined, false, true])('preserves construction=%s without copying source identity, ownership or fixation', construction => {
    const input = corners();
    Object.assign(input[0], { id: 'external-point', fixed: true, standalone: true });
    const graph = rectangleCorners(input, { createId: newCadId, construction });
    expect(graph.entities.every(entity => entity.construction === construction)).toBe(true);
    expect(graph.entities.some(entity => entity.id === 'external-point')).toBe(false);
    expect(graph.entities.filter(entity => entity.type === 'point').every(point => !point.fixed && !point.standalone)).toBe(true);
    expect(graph.coincidences.some(join => [join.pointAId, join.pointBId].includes('external-point'))).toBe(false);
  });

  it.each([
    { dimensioned: false, anchorOrigin: false, dof: 4 },
    { dimensioned: true, anchorOrigin: false, dof: 2 },
    { dimensioned: true, anchorOrigin: true, dof: 0 },
  ])('retains native rectangle freedom with explicit origin intent: %j', async ({ dimensioned, anchorOrigin, dof }) => {
    const { document, graph } = fixture({ dimensioned, anchorOrigin });
    const result = await solveCadDocument(document);
    expect(result.status, JSON.stringify(result.diagnostics)).toBe('solved');
    expect(result.sketches[0]!.dof).toBe(dof);
    expect(result.parts[0]!.outline).toHaveLength(4);
    expect(result.document.parts[0]!.sketch.constraints).toEqual(document.parts[0]!.sketch.constraints);
    expect(result.document.parts[0]!.sketch.entities.filter(entity => entity.type === 'line').map(line => line.id)).toEqual(
      graph.edges.map(line => line.id)
    );
    expect(parseCadDocument(JSON.parse(JSON.stringify(result.document)))).toEqual(result.document);
  });

  it('removes a real native corner relation and independently moves its two aliases without deleting either edge', async () => {
    const { document, graph } = fixture();
    const part = document.parts[0]!;
    const bottom = graph.edges[0];
    part.sketch = addConstraint(part.sketch, { type: 'positionX', pointId: bottom.startId, value: 20 });
    part.sketch = addConstraint(part.sketch, { type: 'positionY', pointId: bottom.startId, value: 10 });
    const before = await solveCadDocument(document);
    expect(before.sketches[0]!.dof).toBe(2);
    const joint = graph.cornerPairs[2];
    const opened = structuredClone(before.document);
    opened.parts[0]!.sketch = removeConstraint(opened.parts[0]!.sketch, graph.coincidences[2].id);
    const released = await solveCadDocument(opened);
    expect(released.sketches[0]!.status).toBe('solved');
    expect(released.sketches[0]!.dof).toBe(4);
    const moved = await solveCadDocument(released.document, {
      drag: [
        { pointId: joint.incomingId, x: 70, y: 55 },
        { pointId: joint.outgoingId, x: 60, y: 40 },
      ],
    });
    expect(moved.sketches[0]!.status, JSON.stringify(moved.diagnostics)).toBe('solved');
    const sketch = moved.document.parts[0]!.sketch;
    const points = new Map(
      sketch.entities.filter((entity): entity is CadPointEntity => entity.type === 'point').map(point => [point.id, point])
    );
    expect(points.get(joint.incomingId)).toMatchObject({ x: 70, y: 55 });
    expect(points.get(joint.outgoingId)).toMatchObject({ x: 60, y: 40 });
    expect(sketch.entities.filter(entity => entity.type === 'line').map(edge => edge.id)).toEqual(graph.edges.map(edge => edge.id));
    expect(sketch.constraints.filter(constraint => constraint.type === 'coincident').map(constraint => constraint.id)).toEqual(
      graph.coincidences.filter((_, index) => index !== 2).map(constraint => constraint.id)
    );
    expect(moved.parts).toHaveLength(0);
  });

  it('deletes an edge and its owned endpoints without deleting its neighboring aliases', () => {
    const { document, graph } = fixture();
    const removed = graph.edges[0];
    const sketch = removeEntity(document.parts[0]!.sketch, removed.id);
    expect(sketch.entities.some(entity => [removed.id, removed.startId, removed.endId].includes(entity.id))).toBe(false);
    expect(sketch.entities.filter(entity => entity.type === 'line').map(edge => edge.id)).toEqual(
      graph.edges.slice(1).map(edge => edge.id)
    );
    const points = new Set(sketch.entities.filter(entity => entity.type === 'point').map(point => point.id));
    expect(
      graph.edges
        .slice(1)
        .flatMap(edge => [edge.startId, edge.endId])
        .every(id => points.has(id))
    ).toBe(true);
    expect(
      sketch.constraints.filter(
        (constraint): constraint is Extract<CadConstraint, { type: 'coincident' }> => constraint.type === 'coincident'
      )
    ).toHaveLength(2);
  });
});
