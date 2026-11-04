import type { Mesh } from './geom';
import type { StepBody } from './import';

/** Raw triangle soup (9 floats per triangle) from a binary or ASCII STL. */
function readTriangles(data: Uint8Array): Float64Array {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const n = data.byteLength >= 84 ? view.getUint32(80, true) : -1;
  if (n >= 0 && 84 + n * 50 === data.byteLength) {
    const out = new Float64Array(n * 9);
    for (let t = 0; t < n; t++) for (let k = 0; k < 9; k++) out[t * 9 + k] = view.getFloat32(84 + t * 50 + 12 + k * 4, true);
    return out;
  }
  const text = new TextDecoder().decode(data);
  const nums = [...text.matchAll(/vertex\s+(\S+)\s+(\S+)\s+(\S+)/g)].flatMap(m => [+m[1], +m[2], +m[3]]);
  if (!nums.length) throw new Error('Not an STL file');
  return Float64Array.from(nums);
}

/**
 * STL → bodies: weld vertices, split into connected components (one per part). STL has no B-rep faces, so every
 * triangle is its own "face"; flat detection still works because it clusters faces by normal.
 */
export function loadStl(data: Uint8Array, name = 'Body'): StepBody[] {
  const tri = readTriangles(data);
  const nTri = tri.length / 9;
  const index = new Map<string, number>();
  const verts: number[] = [];
  const idx = new Uint32Array(nTri * 3);
  for (let i = 0; i < nTri * 3; i++) {
    const x = tri[i * 3],
      y = tri[i * 3 + 1],
      z = tri[i * 3 + 2];
    const key = `${Math.round(x * 1e4)},${Math.round(y * 1e4)},${Math.round(z * 1e4)}`;
    let v = index.get(key);
    if (v === undefined) {
      v = verts.length / 3;
      index.set(key, v);
      verts.push(x, y, z);
    }
    idx[i] = v;
  }
  // Union-find over shared vertices.
  const parent = Int32Array.from({ length: verts.length / 3 }, (_, i) => i);
  const find = (a: number): number => {
    while (parent[a] !== a) a = parent[a] = parent[parent[a]];
    return a;
  };
  for (let t = 0; t < nTri; t++) {
    const a = find(idx[t * 3]);
    parent[find(idx[t * 3 + 1])] = a;
    parent[find(idx[t * 3 + 2])] = a;
  }
  const groups = new Map<number, number[]>();
  for (let t = 0; t < nTri; t++) {
    const r = find(idx[t * 3]);
    let g = groups.get(r);
    if (!g) groups.set(r, (g = []));
    g.push(t);
  }
  const bodies = [...groups.values()].sort((a, b) => b.length - a.length);
  return bodies.map((tris, bi) => {
    const remap = new Map<number, number>();
    const positions: number[] = [];
    const indices = new Uint32Array(tris.length * 3);
    tris.forEach((t, j) => {
      for (let k = 0; k < 3; k++) {
        const v = idx[t * 3 + k];
        let nv = remap.get(v);
        if (nv === undefined) {
          nv = positions.length / 3;
          remap.set(v, nv);
          positions.push(verts[v * 3], verts[v * 3 + 1], verts[v * 3 + 2]);
        }
        indices[j * 3 + k] = nv;
      }
    });
    const mesh: Mesh = {
      positions: Float64Array.from(positions),
      indices,
      faceRanges: tris.map((_, j) => ({ first: j, last: j })),
    };
    return { name: bodies.length > 1 ? `${name} ${bi + 1}` : name, mesh };
  });
}
