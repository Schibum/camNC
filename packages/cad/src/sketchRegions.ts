import { tessellateCurve } from './curves';
import { pointInPolygon } from './geometry';
import { CAD_GEOMETRY_TOLERANCE } from './tolerances';
import type { CadPoint, CadPointEntity, CadSketch } from './types';

/** A bounded face of the drawing. Nested faces are separate regions too. */
export interface CadSketchRegion {
  /**
   * Stable lineage: the bounding curves and the side of each that the region lies on, never coordinates or list
   * indices. It survives solving, dragging and reloading while the same curves bound the same face. Splitting, merging
   * or trimming a region can change it.
   */
  id: string;
  curveIds: string[];
  /** The outer boundary. */
  points: CadPoint[];
  /** Boundaries of whatever is nested inside: these don't change the ID. */
  holes: CadPoint[][];
}
export interface CadSketchRegionOptions {
  /** A closed curve that also bounds regions, such as the part's outline. Only regions inside it are returned. */
  boundary?: { id: string; points: CadPoint[] };
}
/** A point strictly inside a simple counterclockwise polygon: the centre of its first triangle that lies inside. */
function interiorPoint(points: CadPoint[]): CadPoint | null {
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!,
      b = points[(i + 1) % points.length]!,
      c = points[(i + 2) % points.length]!;
    if (cross(b.x - a.x, b.y - a.y, c.x - a.x, c.y - a.y) <= 0) continue;
    const centre = { x: (a.x + b.x + c.x) / 3, y: (a.y + b.y + c.y) / 3 };
    if (pointInPolygon(centre, points)) return centre;
  }
  return null;
}

const epsilon = CAD_GEOMETRY_TOLERANCE;
const distance = (a: CadPoint, b: CadPoint) => Math.hypot(a.x - b.x, a.y - b.y);
const cross = (ax: number, ay: number, bx: number, by: number) => ax * by - ay * bx;
interface Segment {
  a: CadPoint;
  b: CadPoint;
  length: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  cuts: number[];
  curveId: string;
  /** Span of this segment along its curve, 0 to 1. */
  start: number;
  end: number;
}
interface Edge {
  a: number;
  b: number;
  /** The curve this edge belongs to. Coincident curves resolve to the lowest ID, whatever their order in the sketch. */
  curveId: string;
  /** The curve runs from a to b. */
  forward: boolean;
  position: number;
}

function splitContacts(a: Segment, b: Segment): void {
  if (a.maxY + epsilon < b.minY || b.maxY + epsilon < a.minY) return;
  const ax = a.b.x - a.a.x,
    ay = a.b.y - a.a.y,
    bx = b.b.x - b.a.x,
    by = b.b.y - b.a.y;
  const dx = b.a.x - a.a.x,
    dy = b.a.y - a.a.y;
  const determinant = cross(ax, ay, bx, by);
  const add = (segment: Segment, parameter: number) => {
    if (parameter >= -epsilon / segment.length && parameter <= 1 + epsilon / segment.length)
      segment.cuts.push(Math.max(0, Math.min(1, parameter)));
  };
  if (Math.abs(determinant) <= epsilon * Math.max(a.length, b.length)) {
    if (Math.abs(cross(dx, dy, ax, ay)) > epsilon * a.length) return;
    const aa = a.length * a.length,
      bb = b.length * b.length;
    add(a, (dx * ax + dy * ay) / aa);
    add(a, ((b.b.x - a.a.x) * ax + (b.b.y - a.a.y) * ay) / aa);
    add(b, (-dx * bx - dy * by) / bb);
    add(b, ((a.b.x - b.a.x) * bx + (a.b.y - b.a.y) * by) / bb);
    return;
  }
  const t = cross(dx, dy, bx, by) / determinant,
    u = cross(dx, dy, ax, ay) / determinant;
  if (t >= -epsilon / a.length && t <= 1 + epsilon / a.length && u >= -epsilon / b.length && u <= 1 + epsilon / b.length) {
    add(a, t);
    add(b, u);
  }
}

function bridgeEdges(edges: Edge[], adjacency: number[][]): Set<number> {
  const discovery = Array(adjacency.length).fill(-1) as number[],
    low = [...discovery];
  const bridges = new Set<number>();
  let clock = 0;
  for (let root = 0; root < adjacency.length; root++) {
    if (discovery[root] !== -1 || !adjacency[root]!.length) continue;
    discovery[root] = low[root] = clock++;
    const stack = [{ node: root, parentEdge: -1, next: 0 }];
    while (stack.length) {
      const frame = stack.at(-1)!;
      if (frame.next < adjacency[frame.node]!.length) {
        const edgeId = adjacency[frame.node]![frame.next++]!;
        if (edgeId === frame.parentEdge) continue;
        const edge = edges[edgeId]!,
          other = edge.a === frame.node ? edge.b : edge.a;
        if (discovery[other] === -1) {
          discovery[other] = low[other] = clock++;
          stack.push({ node: other, parentEdge: edgeId, next: 0 });
        } else low[frame.node] = Math.min(low[frame.node]!, discovery[other]!);
      } else {
        stack.pop();
        if (frame.parentEdge < 0) continue;
        const edge = edges[frame.parentEdge]!,
          parent = edge.a === frame.node ? edge.b : edge.a;
        low[parent] = Math.min(low[parent]!, low[frame.node]!);
        if (low[frame.node]! > discovery[parent]!) bridges.add(frame.parentEdge);
      }
    }
  }
  return bridges;
}

function signedArea(points: CadPoint[]): number {
  const origin = points[0]!;
  return (
    points.reduce((sum, point, i) => {
      const next = points[(i + 1) % points.length]!;
      return sum + cross(point.x - origin.x, point.y - origin.y, next.x - origin.x, next.y - origin.y);
    }, 0) / 2
  );
}
/**
 * The bounded faces of the drawing, independently of strict single-part CAM validation.
 * Curves remain analytic in the source; only this arrangement is tessellated.
 */
export function sketchRegions(sketch: CadSketch, tolerance = 0.01, options: CadSketchRegionOptions = {}): CadSketchRegion[] {
  const points = new Map(
    sketch.entities.filter((entity): entity is CadPointEntity => entity.type === 'point').map(point => [point.id, point])
  );
  const segments: Segment[] = [];
  for (const entity of sketch.entities) {
    if (entity.type === 'point' || entity.construction) continue;
    let path: CadPoint[];
    try {
      path = tessellateCurve(entity, points, tolerance);
    } catch {
      continue;
    }
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1]!,
        b = path[i]!;
      if (![a?.x, a?.y, b?.x, b?.y].every(Number.isFinite)) continue;
      const length = distance(a, b);
      if (length <= epsilon) continue;
      segments.push({
        a,
        b,
        length,
        minX: Math.min(a.x, b.x),
        maxX: Math.max(a.x, b.x),
        minY: Math.min(a.y, b.y),
        maxY: Math.max(a.y, b.y),
        cuts: [0, 1],
        curveId: entity.id,
        start: (i - 1) / (path.length - 1),
        end: i / (path.length - 1),
      });
    }
  }
  const boundary = options.boundary?.points ?? [];
  boundary.forEach((a, i) => {
    const b = boundary[(i + 1) % boundary.length]!,
      length = distance(a, b);
    if (length <= epsilon) return;
    segments.push({
      a,
      b,
      length,
      minX: Math.min(a.x, b.x),
      maxX: Math.max(a.x, b.x),
      minY: Math.min(a.y, b.y),
      maxY: Math.max(a.y, b.y),
      cuts: [0, 1],
      curveId: options.boundary!.id,
      start: i / boundary.length,
      end: (i + 1) / boundary.length,
    });
  });
  segments.sort((a, b) => a.minX - b.minX || a.minY - b.minY);
  let active: Segment[] = [];
  for (const segment of segments) {
    active = active.filter(other => other.maxX + epsilon >= segment.minX);
    for (const other of active) splitContacts(segment, other);
    active.push(segment);
  }
  const nodes: CadPoint[] = [],
    buckets = new Map<string, number[]>();
  const node = (point: CadPoint): number => {
    const x = Math.floor(point.x / epsilon),
      y = Math.floor(point.y / epsilon);
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (const index of buckets.get(`${x + dx}:${y + dy}`) ?? []) if (distance(nodes[index]!, point) <= epsilon) return index;
    const index = nodes.length,
      key = `${x}:${y}`;
    nodes.push(point);
    buckets.set(key, [...(buckets.get(key) ?? []), index]);
    return index;
  };
  const edges: Edge[] = [],
    keys = new Map<string, number>();
  for (const segment of segments) {
    segment.cuts.sort((a, b) => a - b);
    const cuts = segment.cuts.filter((cut, i, all) => i === 0 || (cut - all[i - 1]!) * segment.length > epsilon);
    const at = (t: number) => ({ x: segment.a.x + (segment.b.x - segment.a.x) * t, y: segment.a.y + (segment.b.y - segment.a.y) * t });
    for (let i = 1; i < cuts.length; i++) {
      const a = node(at(cuts[i - 1]!)),
        b = node(at(cuts[i]!));
      if (a === b) continue;
      const key = a < b ? `${a}:${b}` : `${b}:${a}`,
        position = segment.start + ((segment.end - segment.start) * (cuts[i - 1]! + cuts[i]!)) / 2,
        known = keys.get(key);
      if (known === undefined) {
        keys.set(key, edges.length);
        edges.push({ a, b, curveId: segment.curveId, forward: true, position });
      } else {
        const edge = edges[known]!;
        if (segment.curveId < edge.curveId || (segment.curveId === edge.curveId && position < edge.position))
          Object.assign(edge, { curveId: segment.curveId, forward: edge.a === a, position });
      }
    }
  }
  const adjacency = nodes.map(() => [] as number[]);
  edges.forEach((edge, i) => {
    adjacency[edge.a]!.push(i);
    adjacency[edge.b]!.push(i);
  });
  const bridges = bridgeEdges(edges, adjacency);
  const outgoing = nodes.map(() => [] as number[]);
  edges.forEach((edge, i) => {
    if (!bridges.has(i)) {
      outgoing[edge.a]!.push(i * 2);
      outgoing[edge.b]!.push(i * 2 + 1);
    }
  });
  const from = (half: number) => (half % 2 ? edges[half >> 1]!.b : edges[half >> 1]!.a);
  const to = (half: number) => (half % 2 ? edges[half >> 1]!.a : edges[half >> 1]!.b);
  const position = new Int32Array(edges.length * 2);
  outgoing.forEach((list, vertex) => {
    const origin = nodes[vertex]!;
    list.sort(
      (a, b) =>
        Math.atan2(nodes[to(a)]!.y - origin.y, nodes[to(a)]!.x - origin.x) -
        Math.atan2(nodes[to(b)]!.y - origin.y, nodes[to(b)]!.x - origin.x)
    );
    list.forEach((half, i) => {
      position[half] = i;
    });
  });
  const visited = new Set<number>(),
    faces: { points: CadPoint[]; area: number; sides: Map<string, number> }[] = [],
    outerCycles: { points: CadPoint[]; area: number }[] = [];
  for (const list of outgoing)
    for (const first of list) {
      if (visited.has(first)) continue;
      const polygon: CadPoint[] = [],
        sides = new Map<string, number>();
      let half = first;
      while (!visited.has(half)) {
        visited.add(half);
        polygon.push(nodes[from(half)]!);
        // Faces are counterclockwise, so the face lies to the left of the direction of travel.
        const edge = edges[half >> 1]!,
          side = `${edge.curveId}:${(half % 2 === 0) === edge.forward ? 'L' : 'R'}`;
        sides.set(side, Math.min(sides.get(side) ?? Infinity, edge.position));
        const next = outgoing[to(half)]!,
          reverse = half ^ 1;
        half = next[(position[reverse]! + next.length - 1) % next.length]!;
      }
      if (half !== first || polygon.length < 3) continue;
      const area = signedArea(polygon);
      if (area > epsilon * epsilon * polygon.length) faces.push({ points: polygon, area, sides });
      else if (area < -epsilon * epsilon * polygon.length) outerCycles.push({ points: polygon, area: -area });
    }
  // Every bounded region counts, including nested discs. Material holes are a CAM decision.
  // A clockwise cycle is the outside of a connected drawing: it's a hole in the smallest face that contains it.
  const holes = new Map(faces.map(face => [face, [] as CadPoint[][]]));
  for (const cycle of outerCycles) {
    const host = faces
      // A face of the same drawing shares its nodes, including a disc's own outline.
      .filter(face => !face.points.includes(cycle.points[0]!) && pointInPolygon(cycle.points[0]!, face.points))
      .reduce<(typeof faces)[number] | null>((best, face) => (!best || face.area < best.area ? face : best), null);
    if (host) holes.get(host)!.push(cycle.points);
  }
  const named = faces
    .filter(face => {
      if (!options.boundary) return true;
      const inside = interiorPoint(face.points);
      return !!inside && pointInPolygon(inside, boundary);
    })
    .map(face => {
      const sides = [...face.sides.keys()].sort();
      return { ...face, signature: sides.join('|'), order: sides.map(side => face.sides.get(side)!) };
    });
  const bySignature = new Map<string, typeof named>();
  for (const face of named) bySignature.set(face.signature, [...(bySignature.get(face.signature) ?? []), face]);
  return [...bySignature.entries()]
    .flatMap(([signature, group]) => {
      // The lenses between a wavy curve and a line share a signature: their order along the curves tells them apart.
      group.sort((a, b) => {
        const i = a.order.findIndex((value, n) => value !== b.order[n]);
        return i < 0 ? 0 : a.order[i]! - b.order[i]!;
      });
      return group.map((face, n) => ({
        id: `${sketch.id}:region:${signature}${group.length > 1 ? `#${n}` : ''}`,
        curveIds: [...new Set([...face.sides.keys()].map(side => side.slice(0, side.lastIndexOf(':'))))],
        points: face.points,
        holes: holes.get(faces.find(candidate => candidate.points === face.points)!)!,
      }));
    })
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
