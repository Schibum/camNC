import type { CadConstraint, CadEntity, CadLineEntity, CadPoint, CadPointEntity } from './types';

type Four<T> = [T, T, T, T];

export interface CadRectangleCornerPair {
  /** End of the edge arriving at this corner. */
  incomingId: string;
  /** Start of the edge leaving this corner. */
  outgoingId: string;
}

export interface CadRectangleCornerGraph {
  entities: CadEntity[];
  /** Same traversal order as the four supplied corners. */
  edges: Four<CadLineEntity>;
  /** Pair i lies at supplied corner i. Removing its relation separates the edges. */
  cornerPairs: Four<CadRectangleCornerPair>;
  coincidences: Four<Extract<CadConstraint, { type: 'coincident' }>>;
}

/**
 * Each edge owns both endpoints. Only explicit Coincident relations join corners;
 * matching coordinates never reuse external points or make an undeletable joint.
 * The caller supplies the ID allocator, avoiding a dependency on document commands.
 */
export function rectangleCorners(
  corners: readonly [CadPoint, CadPoint, CadPoint, CadPoint],
  { createId, construction }: { createId: () => string; construction?: boolean }
): CadRectangleCornerGraph {
  const points: CadPointEntity[] = [];
  const edges = corners.map((corner, index): CadLineEntity => {
    const next = corners[(index + 1) % 4]!;
    const start: CadPointEntity = {
      id: createId(),
      type: 'point',
      x: corner.x,
      y: corner.y,
      construction,
      standalone: false,
    };
    const end: CadPointEntity = {
      id: createId(),
      type: 'point',
      x: next.x,
      y: next.y,
      construction,
      standalone: false,
    };
    points.push(start, end);
    return { id: createId(), type: 'line', startId: start.id, endId: end.id, construction };
  }) as Four<CadLineEntity>;
  const cornerPairs = edges.map((edge, index) => ({
    incomingId: edges[(index + 3) % 4]!.endId,
    outgoingId: edge.startId,
  })) as Four<CadRectangleCornerPair>;
  const coincidences = cornerPairs.map(({ incomingId, outgoingId }) => ({
    id: createId(),
    type: 'coincident' as const,
    pointAId: incomingId,
    pointBId: outgoingId,
  })) as Four<Extract<CadConstraint, { type: 'coincident' }>>;
  return { entities: [...points, ...edges], edges, cornerPairs, coincidences };
}
