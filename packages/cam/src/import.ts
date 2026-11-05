/// <reference path="./types/occt-import-js.d.ts" />
import occtimportjs, { type OcctModule, type OcctNode } from 'occt-import-js';
import { cross, dot, length, meshBounds, normalize, scale, sub, triangle, triangleNormal2A, type Mesh, type Vec3 } from './geom';

export interface StepBody {
  name: string;
  mesh: Mesh;
}

export interface LoadStepResult {
  bodies: StepBody[];
  initMs: number;
  readMs: number;
}

export interface LoadStepOptions {
  /** Chordal deviation of the tessellation in mm. */
  linearDeflection?: number;
  angularDeflection?: number;
  /** For browsers/workers: where to fetch occt-import-js.wasm from. */
  locateFile?: (path: string) => string;
}

let occtPromise: Promise<OcctModule> | undefined;
let occtInitMs = 0;

async function getOcct(locateFile?: (path: string) => string) {
  if (!occtPromise) {
    const t0 = performance.now();
    occtPromise = occtimportjs(locateFile ? { locateFile } : undefined).then(m => {
      occtInitMs = performance.now() - t0;
      return m;
    });
  }
  return occtPromise;
}

export async function loadStep(data: Uint8Array, opts: LoadStepOptions = {}): Promise<LoadStepResult> {
  const occt = await getOcct(opts.locateFile);
  const t0 = performance.now();
  const res = occt.ReadStepFile(data, {
    linearUnit: 'millimeter',
    linearDeflectionType: 'absolute_value',
    linearDeflection: opts.linearDeflection ?? 0.01,
    angularDeflection: opts.angularDeflection ?? 0.1,
  });
  const readMs = performance.now() - t0;
  if (!res.success) throw new Error('occt failed to read STEP file');

  // Prefer the assembly node name (the meshes are often unnamed copies).
  const nodeNames = new Map<number, string>();
  const walk = (n: OcctNode) => {
    for (const m of n.meshes) nodeNames.set(m, n.name);
    n.children.forEach(walk);
  };
  walk(res.root);

  const bodies = res.meshes.map((m, i) => ({
    name: nodeNames.get(i) || m.name || `Body ${i + 1}`,
    mesh: {
      positions: Float64Array.from(m.attributes.position.array),
      indices: Uint32Array.from(m.index.array),
      faceRanges: m.brep_faces.map(f => ({ first: f.first, last: f.last })),
    },
  }));
  return { bodies, initMs: occtInitMs, readMs };
}

// ---- B-rep face analysis ----

export interface FaceInfo {
  planar: boolean;
  /** Unit normal (area weighted average). */
  normal: Vec3;
  /** Plane offset: dot(normal, p) for points on the face. */
  d: number;
  area: number;
}

export function analyzeFaces(mesh: Mesh, angleTol = 1e-4, distTol = 1e-3): FaceInfo[] {
  return mesh.faceRanges.map(({ first, last }) => {
    let n: Vec3 = [0, 0, 0];
    const tris: [Vec3, Vec3, Vec3][] = [];
    for (let t = first; t <= last; t++) {
      const tri = triangle(mesh, t);
      tris.push(tri);
      const tn = triangleNormal2A(...tri);
      n = [n[0] + tn[0], n[1] + tn[1], n[2] + tn[2]];
    }
    const area = length(n) / 2;
    const normal = normalize(n);
    const d = tris.length ? dot(normal, tris[0][0]) : 0;
    let planar = area > 0;
    for (const tri of tris) {
      if (!planar) break;
      const tn = triangleNormal2A(...tri);
      const tl = length(tn);
      if (tl > 1e-9 && 1 - dot(normal, scale(tn, 1 / tl)) > angleTol) planar = false;
      for (const v of tri) if (Math.abs(dot(normal, v) - d) > distTol) planar = false;
    }
    return { planar, normal, d, area };
  });
}

// ---- Flat part detection ----

export interface FlatPart {
  name: string;
  /** Mesh rotated so the thickness axis is +Z, translated so the bbox min is (0,0,0). */
  mesh: Mesh;
  size: Vec3;
  thickness: number;
  /** Rows of the rotation applied to the original mesh (new x, y, z axes in original coords). */
  axes: [Vec3, Vec3, Vec3];
  /** Subtracted after rotating: flat = (dot(axes[i], p) - origin[i]). */
  origin: Vec3;
  /** Area of horizontal floors between top and bottom that face up (machinable from the top). */
  topFeatureArea: number;
  /** Same for faces that face down, i.e. features that need the part flipped. */
  bottomFeatureArea: number;
  /** True if we put the original "-axis" side up because more features face that way. */
  flipped: boolean;
  /**
   * Fraction of the surface (by area) that is horizontal or vertical: planar floors and walls of any shape, curved
   * outlines and pocket corner radii included (1 = pure 2.5D prism).
   */
  prismaticRatio: number;
  /**
   * Sloped or 3D-curved surface (chamfers, fillets, edge rounds, carved shapes), as its area seen from above
   * relative to the part's top area. A flat bit leaves these square; above a few percent it's not a flat board.
   */
  slopedShare: number;
  /** The same sloped faces' surface area, mm². */
  slopedArea: number;
}

/** Above this sloped share (of the top area) a part is a 3D part, not a flat board. */
export const kMaxSlopedShare = 0.05;

const DIR_TOL = 1e-4;

/** Canonical sign so +n and -n land in the same cluster. */
function canonicalAxis(n: Vec3): Vec3 {
  for (const c of n) {
    if (Math.abs(c) > 1e-6) return c < 0 ? scale(n, -1) : n;
  }
  return n;
}

function extentAlong(mesh: Mesh, axis: Vec3) {
  let min = Infinity,
    max = -Infinity;
  const p = mesh.positions;
  for (let i = 0; i < p.length; i += 3) {
    const v = axis[0] * p[i] + axis[1] * p[i + 1] + axis[2] * p[i + 2];
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return { min, max };
}

/**
 * Find the dominant thickness axis (the planar-face direction with the most area that has opposing faces on both
 * sides), decide which side faces up, and rotate the part to lie flat with its longer side along X.
 */
export function detectFlat(body: StepBody): FlatPart {
  const faces = analyzeFaces(body.mesh);
  const totalArea = faces.reduce((s, f) => s + f.area, 0);
  const clusters: { axis: Vec3; area: number; pos: number; neg: number }[] = [];
  for (const f of faces) {
    if (!f.planar) continue;
    const a = canonicalAxis(f.normal);
    let c = clusters.find(c => 1 - Math.abs(dot(c.axis, a)) < DIR_TOL);
    if (!c) clusters.push((c = { axis: a, area: 0, pos: 0, neg: 0 }));
    c.area += f.area;
    if (dot(c.axis, f.normal) > 0) c.pos += f.area;
    else c.neg += f.area;
  }
  clusters.sort((a, b) => b.area - a.area);
  const thick = clusters.find(c => c.pos > 0 && c.neg > 0) ?? clusters[0];
  if (!thick) throw new Error(`${body.name}: no planar faces, cannot find a flat orientation`);
  const axis = thick.axis;
  const ext = extentAlong(body.mesh, axis);
  const thickness = ext.max - ext.min;

  // Horizontal floors strictly between bottom and top: facing +axis are reachable with axis up, facing -axis need -axis up.
  let posFloor = 0,
    negFloor = 0;
  // By triangle area: vertical walls of any shape (arcs, splines) and horizontal faces are 2.5D, the rest is sloped.
  let prismatic = 0,
    slopedArea = 0,
    slopedProjected = 0,
    topProjected = 0;
  const nTri = body.mesh.indices.length / 3;
  for (let t = 0; t < nTri; t++) {
    const n2a = triangleNormal2A(...triangle(body.mesh, t));
    const area = length(n2a) / 2;
    if (area < 1e-12) continue;
    const c = dot(n2a, axis) / (2 * area);
    if (c > 0) topProjected += area * c;
    if (Math.abs(c) < 0.01 || Math.abs(c) > 0.9999) prismatic += area;
    else {
      slopedArea += area;
      slopedProjected += area * Math.abs(c);
    }
  }
  const tol = 0.01;
  for (const f of faces) {
    if (!f.planar) continue;
    const c = dot(f.normal, axis);
    if (Math.abs(Math.abs(c) - 1) > DIR_TOL) continue;
    const h = c > 0 ? f.d : -f.d; // height along +axis
    if (h <= ext.min + tol || h >= ext.max - tol) continue;
    if (c > 0) posFloor += f.area;
    else negFloor += f.area;
  }
  const flipped = negFloor > posFloor;
  const z: Vec3 = flipped ? scale(axis, -1) : axis;

  // In-plane orientation: align to the biggest wall direction, long side along X.
  const walls = clusters.filter(c => Math.abs(dot(c.axis, axis)) < 1e-4);
  let u: Vec3;
  if (walls.length) {
    const n = walls[0].axis;
    u = normalize(sub(n, scale(z, dot(n, z))));
  } else {
    u = normalize(cross(z, Math.abs(z[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]));
  }
  let v = cross(z, u);
  const eu = extentAlong(body.mesh, u);
  const ev = extentAlong(body.mesh, v);
  // u is a wall normal, so walls run along v; make the longer extent X.
  let x = u,
    y = v;
  if (ev.max - ev.min > eu.max - eu.min) {
    x = v;
    y = scale(u, -1);
  }
  v = y;
  const axes: [Vec3, Vec3, Vec3] = [x, v, z];

  const src = body.mesh.positions;
  const positions = new Float64Array(src.length);
  for (let i = 0; i < src.length; i += 3) {
    const p: Vec3 = [src[i], src[i + 1], src[i + 2]];
    positions[i] = dot(axes[0], p);
    positions[i + 1] = dot(axes[1], p);
    positions[i + 2] = dot(axes[2], p);
  }
  const mesh: Mesh = { positions, indices: body.mesh.indices, faceRanges: body.mesh.faceRanges };
  const b = meshBounds(mesh);
  for (let i = 0; i < positions.length; i += 3) {
    positions[i] -= b.min[0];
    positions[i + 1] -= b.min[1];
    positions[i + 2] -= b.min[2];
  }
  const size: Vec3 = [b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]];

  return {
    name: body.name,
    mesh,
    size,
    thickness,
    axes,
    origin: b.min,
    topFeatureArea: flipped ? negFloor : posFloor,
    bottomFeatureArea: flipped ? posFloor : negFloor,
    flipped,
    prismaticRatio: totalArea > 0 ? prismatic / totalArea : 0,
    slopedShare: topProjected > 0 ? slopedProjected / topProjected : 1,
    slopedArea,
  };
}

/** Column-major 4x4 matrix (three.js `Matrix4.fromArray`) taking original model coordinates to the flat frame. */
export function flatMatrix(part: Pick<FlatPart, 'axes' | 'origin'>): number[] {
  const [x, y, z] = part.axes;
  const o = part.origin;
  return [x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -o[0], -o[1], -o[2], 1];
}

/**
 * Second setup: turn the part over. Around its X axis (x, y, z) -> (x, Ymax - y, T - z) by default; around its Y axis
 * (x, y, z) -> (Xmax - x, y, T - z) for a part lying turned on a board that is flipped top to bottom.
 */
export function flipPart(part: FlatPart, axis: 'x' | 'y' = 'x'): FlatPart {
  const src = part.mesh.positions;
  const positions = new Float64Array(src.length);
  for (let i = 0; i < src.length; i += 3) {
    positions[i] = axis === 'y' ? part.size[0] - src[i] : src[i];
    positions[i + 1] = axis === 'x' ? part.size[1] - src[i + 1] : src[i + 1];
    positions[i + 2] = part.size[2] - src[i + 2];
  }
  const [x, y, z] = part.axes;
  return {
    ...part,
    name: `${part.name} (flipped)`,
    // Turning over is a rotation (two axes flip): faces keep their winding.
    mesh: { ...part.mesh, positions },
    axes: axis === 'x' ? [x, scale(y, -1), scale(z, -1)] : [scale(x, -1), y, scale(z, -1)],
    origin:
      axis === 'x'
        ? [part.origin[0], -part.origin[1] - part.size[1], -part.origin[2] - part.size[2]]
        : [-part.origin[0] - part.size[0], part.origin[1], -part.origin[2] - part.size[2]],
    topFeatureArea: part.bottomFeatureArea,
    bottomFeatureArea: part.topFeatureArea,
    flipped: !part.flipped,
  };
}

/** Vertex moments around the bbox center, insensitive to a 180° turn but not to mirroring (left/right sides). */
function moments(p: FlatPart) {
  const v = p.mesh.positions;
  const [cx, cy] = [p.size[0] / 2, p.size[1] / 2];
  let mx = 0,
    my = 0,
    mxy = 0;
  for (let i = 0; i < v.length; i += 3) {
    const x = v[i] - cx,
      y = v[i + 1] - cy;
    mx += x;
    my += y;
    mxy += x * y;
  }
  const n = v.length / 3 || 1;
  // A 180° turn (same board) flips the signs of mx and my only; a mirror also flips mxy.
  return [Math.abs(mx / n), Math.abs(my / n), mxy / n].map(m => (Math.abs(m) < 0.05 ? 0 : m).toFixed(1));
}

/**
 * Group bodies that are the same board (e.g. two identical shelves); mirrored boards stay separate.
 * `members` keeps the original parts, including the representative: body names need not be unique.
 */
export function groupIdentical(parts: FlatPart[]): { part: FlatPart; names: string[]; members: FlatPart[] }[] {
  const groups: { part: FlatPart; names: string[]; members: FlatPart[] }[] = [];
  // Bounds and moments only find candidates: e.g. changing a pocket's depth changes none of their XY moments.
  const key = (p: FlatPart) => [...p.size.map(s => s.toFixed(2)), p.mesh.indices.length, ...moments(p)].join('|');
  type Geometry = { vertices: Vec3[]; boundary: Set<string> };
  const edgeKey = (a: number, b: number) => (a < b ? `${a},${b}` : `${b},${a}`);
  const geometry = new WeakMap<FlatPart, Geometry[]>();
  const signature = (p: FlatPart, turned = false) => {
    let cached = geometry.get(p);
    if (!cached) geometry.set(p, (cached = []));
    const orientation = turned ? 1 : 0;
    if (cached[orientation] !== undefined) return cached[orientation];
    // Weld duplicated face vertices at the STL importer's precision. Keep full coordinates for tolerant comparisons:
    // float32 STL exports can land on opposite sides of a rounding boundary despite describing the same surface.
    const vertices: Vec3[] = [];
    const welded = new Map<string, number>();
    const indices = Array.from({ length: p.mesh.positions.length / 3 }, (_, i) => {
      const x = p.mesh.positions[i * 3],
        y = p.mesh.positions[i * 3 + 1],
        z = p.mesh.positions[i * 3 + 2];
      const key = [x, y, z].map(v => Math.round(v * 1e4)).join(',');
      let index = welded.get(key);
      if (index === undefined) {
        welded.set(key, (index = vertices.length));
        vertices.push([turned ? p.size[0] - x : x, turned ? p.size[1] - y : y, z]);
      }
      return index;
    });
    const edges = new Map<string, { normal: Vec3; count: number; planar: boolean }>();
    for (let i = 0; i < p.mesh.indices.length; i += 3) {
      const normal = triangleNormal2A(...triangle(p.mesh, i / 3));
      if (length(normal) < 1e-12) continue;
      const unit = normalize(normal);
      for (let j = 0; j < 3; j++) {
        const a = indices[p.mesh.indices[i + j]],
          b = indices[p.mesh.indices[i + ((j + 1) % 3)]];
        if (a === b) continue;
        const edge = edgeKey(a, b);
        const prior = edges.get(edge);
        if (prior) {
          prior.count++;
          prior.planar &&= 1 - Math.abs(dot(prior.normal, unit)) < 1e-8;
        } else edges.set(edge, { normal: unit, count: 1, planar: true });
      }
    }
    // Internal diagonals of planar faces may differ between otherwise identical copies.
    const boundary = new Set([...edges].filter(([, e]) => e.count !== 2 || !e.planar).map(([edge]) => edge));
    return (cached[orientation] = { vertices, boundary });
  };
  const sameGeometry = (a: Geometry, b: Geometry) => {
    if (a.vertices.length !== b.vertices.length || a.boundary.size !== b.boundary.size) return false;
    const tolerance = 0.01;
    const grid = new Map<string, number[]>();
    a.vertices.forEach((v, i) => {
      const key = v.map(c => Math.floor(c / tolerance)).join(',');
      const cell = grid.get(key);
      if (cell) cell.push(i);
      else grid.set(key, [i]);
    });
    const used = new Set<number>();
    const mapping: number[] = [];
    for (const v of b.vertices) {
      const cell = v.map(c => Math.floor(c / tolerance));
      let best = -1,
        distance = tolerance;
      for (let x = -1; x <= 1; x++)
        for (let y = -1; y <= 1; y++)
          for (let z = -1; z <= 1; z++)
            for (const i of grid.get(`${cell[0] + x},${cell[1] + y},${cell[2] + z}`) ?? []) {
              const d = length(sub(v, a.vertices[i]));
              if (!used.has(i) && d <= distance) [best, distance] = [i, d];
            }
      if (best < 0) return false;
      mapping.push(best);
      used.add(best);
    }
    return [...b.boundary].every(edge => {
      const [x, y] = edge.split(',').map(Number);
      return a.boundary.has(edgeKey(mapping[x], mapping[y]));
    });
  };
  for (const p of parts) {
    const g = groups.find(
      g => key(g.part) === key(p) && (sameGeometry(signature(g.part), signature(p)) || sameGeometry(signature(g.part), signature(p, true)))
    );
    if (g) {
      g.names.push(p.name);
      g.members.push(p);
    } else groups.push({ part: p, names: [p.name], members: [p] });
  }
  return groups;
}
