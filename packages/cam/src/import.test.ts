import { statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { readStep } from './fixtures';
import type { Mesh } from './geom';
import { detectFlat, groupIdentical, loadStep } from './import';

/** A closed 100 x 80 x 8 board with a rectangular pocket, with identical tessellation at every pocket depth. */
function pocketedBoard(name: string, floor: number) {
  const rect = (x0: number, y0: number, x1: number, y1: number, z: number) => [x0, y0, z, x1, y0, z, x1, y1, z, x0, y1, z];
  const positions = Float64Array.from([
    ...rect(0, 0, 100, 80, 0),
    ...rect(0, 0, 100, 80, 8),
    ...rect(15, 10, 55, 50, 8),
    ...rect(15, 10, 55, 50, floor),
  ]);
  const indices: number[] = [];
  const face = (a: number, b: number, c: number, d: number) => indices.push(a, b, c, a, c, d);
  face(0, 3, 2, 1);
  face(12, 13, 14, 15);
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    face(i, j, j + 4, i + 4);
    face(i + 4, j + 4, j + 8, i + 8);
    face(i + 8, j + 8, j + 12, i + 12);
  }
  const mesh: Mesh = {
    positions,
    indices: Uint32Array.from(indices),
    faceRanges: Array.from({ length: indices.length / 3 }, (_, i) => ({ first: i, last: i })),
  };
  return detectFlat({ name, mesh });
}

describe('identical parts', () => {
  it('keeps different pocket depths separate, even with the same bounds, XY vertices and triangle count', () => {
    const shallow = pocketedBoard('shallow', 5);
    const deep = pocketedBoard('deep', 2);
    expect(shallow.size).toEqual(deep.size);
    expect(shallow.mesh.indices.length).toBe(deep.mesh.indices.length);
    expect(groupIdentical([shallow, deep]).map(g => g.names)).toEqual([['shallow'], ['deep']]);
  });

  it('keeps original group members when different pocket depths share the same body name', () => {
    const shallow = pocketedBoard('Part', 5);
    const deep = pocketedBoard('Part', 2);
    const copy = pocketedBoard('Part', 5);
    const groups = groupIdentical([shallow, deep, copy]);
    expect(groups.map(g => g.names)).toEqual([['Part', 'Part'], ['Part']]);
    expect(groups[0].members).toHaveLength(2);
    expect(groups[0].members[0]).toBe(shallow);
    expect(groups[0].members[1]).toBe(copy);
    expect(groups[1].members).toHaveLength(1);
    expect(groups[1].members[0]).toBe(deep);
  });

  it('compares coordinates within tolerance across rounding boundaries', () => {
    const a = pocketedBoard('below boundary', 4.005 - 1e-5);
    const b = pocketedBoard('above boundary', 4.005 + 1e-5);
    const different = pocketedBoard('different depth', 4.025);
    expect(groupIdentical([a, b, different]).map(g => g.names)).toEqual([['below boundary', 'above boundary'], ['different depth']]);
  });

  it('ignores duplicated face vertices when checking the same surface', () => {
    const part = pocketedBoard('original', 4);
    const count = part.mesh.positions.length / 3;
    const copy = {
      ...part,
      name: 'duplicated vertices',
      mesh: {
        ...part.mesh,
        positions: Float64Array.from([...part.mesh.positions, ...part.mesh.positions]),
        indices: Uint32Array.from(part.mesh.indices, (v, i) => v + (i % 2 ? count : 0)),
      },
    };
    expect(groupIdentical([part, copy]).map(g => g.names)).toEqual([['original', 'duplicated vertices']]);
  });

  it('groups a reindexed 180-degree copy but keeps its mirror separate', () => {
    const part = pocketedBoard('original', 4);
    const positions = new Float64Array(part.mesh.positions.length);
    const count = positions.length / 3;
    for (let i = 0; i < count; i++) {
      positions[(count - i - 1) * 3] = part.size[0] - part.mesh.positions[i * 3];
      positions[(count - i - 1) * 3 + 1] = part.size[1] - part.mesh.positions[i * 3 + 1];
      positions[(count - i - 1) * 3 + 2] = part.mesh.positions[i * 3 + 2];
    }
    const turned = {
      ...part,
      name: 'turned',
      mesh: { ...part.mesh, positions, indices: Uint32Array.from(part.mesh.indices, i => count - i - 1).reverse() },
    };
    const mirror = {
      ...part,
      name: 'mirror',
      mesh: { ...part.mesh, positions: Float64Array.from(part.mesh.positions, (v, i) => (i % 3 === 0 ? part.size[0] - v : v)) },
    };
    expect(groupIdentical([part, turned, mirror]).map(g => g.names)).toEqual([['original', 'turned'], ['mirror']]);
  });

  it('ignores a different planar-face diagonal, but checks connectivity when it changes the surface', () => {
    const part = pocketedBoard('original', 4);
    const indices = part.mesh.indices.slice();
    // The pocket floor's two triangles, using its other diagonal.
    indices.set([12, 13, 15, 13, 14, 15], 6);
    const other = { ...part, name: 'other diagonal', mesh: { ...part.mesh, indices } };
    expect(groupIdentical([part, other]).map(g => g.names)).toEqual([['original', 'other diagonal']]);
    // With one corner lifted, those two diagonals describe different surfaces despite an identical vertex cloud.
    const positions = part.mesh.positions.slice();
    positions[12 * 3 + 2] += 1;
    const warped = { ...part, mesh: { ...part.mesh, positions } };
    const warpedOther = { ...other, mesh: { ...other.mesh, positions } };
    expect(groupIdentical([warped, warpedOther]).map(g => g.names)).toEqual([['original'], ['other diagonal']]);
  });
});

describe('spike 1: STEP import + flat detection', () => {
  it('loads kinderregal and finds the six flat parts', async () => {
    const { bodies, initMs, readMs } = await loadStep(readStep('kinderregal eiche'));
    const wasm = createRequire(import.meta.url).resolve('occt-import-js/dist/occt-import-js.wasm');
    const t0 = performance.now();
    const parts = bodies.map(detectFlat);
    const flatMs = performance.now() - t0;
    console.log(
      `occt init ${initMs.toFixed(0)}ms, read ${readMs.toFixed(0)}ms, flat ${flatMs.toFixed(0)}ms, wasm ${(statSync(wasm).size / 1e6).toFixed(2)}MB`
    );
    for (const p of parts)
      console.log(
        `${p.name.padEnd(8)} ${p.size.map(s => s.toFixed(2)).join(' x ')}  tris ${p.mesh.indices.length / 3}  ` +
          `top ${p.topFeatureArea.toFixed(0)}mm² bottom ${p.bottomFeatureArea.toFixed(0)}mm² flipped ${p.flipped} prismatic ${(p.prismaticRatio * 100).toFixed(1)}%`
      );
    const dims = groupIdentical(parts).map(g => `${g.part.size.map(s => s.toFixed(1)).join('x')} x${g.names.length}`);
    console.log(dims);
    // left/right are mirror images: same size and triangle count, but not the same board.
    expect(dims.sort()).toEqual([
      '400.0x136.5x8.0 x1',
      '400.0x140.0x8.0 x2',
      '400.0x380.0x3.0 x1',
      '560.0x140.0x8.0 x1',
      '560.0x140.0x8.0 x1',
    ]);
    expect(parts).toHaveLength(6);
    // Long side goes along X, so the back panel (380x400 in the brief) reads 400x380.
    const sorted = parts.map(p => p.size.map(s => +s.toFixed(1)).join('x')).sort();
    expect(sorted).toEqual(['400x136.5x8', '400x140x8', '400x140x8', '400x380x3', '560x140x8', '560x140x8']);
    for (const p of parts) expect(p.bottomFeatureArea).toBe(0);
  });

  it.each(['besteckkasten', 'messerblock klein'])('analyzes %s', async name => {
    const { bodies, readMs } = await loadStep(readStep(name));
    console.log(`${name}: read ${readMs.toFixed(0)}ms`);
    for (const p of bodies.map(detectFlat))
      console.log(
        `  ${p.name.padEnd(14)} ${p.size.map(s => s.toFixed(2)).join(' x ')}  top ${p.topFeatureArea.toFixed(0)} bottom ${p.bottomFeatureArea.toFixed(0)} flipped ${p.flipped} prismatic ${(p.prismaticRatio * 100).toFixed(1)}%`
      );
  });
});
