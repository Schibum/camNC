import { describe, expect, it } from 'vitest';
import { extractFeatures } from './features';
import { readStep } from './fixtures';
import type { Mesh } from './geom';
import { detectFlat, flatMatrix, groupIdentical, loadStep } from './import';
import { loadStl } from './stl';
import { summarizePart } from './summary';

async function summaries(name: string) {
  const { bodies } = await loadStep(readStep(name));
  return bodies.map(b => {
    const part = detectFlat(b);
    return { part, summary: summarizePart(part, extractFeatures(part.mesh, part.thickness)) };
  });
}

/** Binary STL of the given meshes (what a CAD export of the same model would give). */
function toStl(meshes: Mesh[]): Uint8Array {
  const n = meshes.reduce((s, m) => s + m.indices.length / 3, 0);
  const buf = new DataView(new ArrayBuffer(84 + n * 50));
  buf.setUint32(80, n, true);
  let o = 84;
  for (const m of meshes)
    for (let t = 0; t < m.indices.length; t += 3) {
      o += 12;
      for (let k = 0; k < 3; k++) for (let c = 0; c < 3; c++, o += 4) buf.setFloat32(o, m.positions[m.indices[t + k] * 3 + c], true);
      o += 2;
    }
  return new Uint8Array(buf.buffer);
}

describe('part summary for the Model screen', () => {
  it('kinderregal: feature chips, inside radius, nothing to flip', async () => {
    const res = await summaries('kinderregal eiche');
    const by = Object.fromEntries(res.map(r => [r.part.name, r.summary]));
    for (const r of res) console.log(r.part.name, JSON.stringify(r.summary));
    expect(by.right.chips.map(c => c.label)).toEqual(['9 pockets 4.2 deep', 'edge groove 4.5 deep', 'curved edge']);
    expect(by['Part 1'].chips.map(c => c.label)).toEqual(['edge groove 4.5 deep']);
    expect(by['Part 2'].chips.map(c => c.label)).toEqual(['outline only']);
    expect(by.back.chips.map(c => c.label)).toEqual(['outline only']);
    expect(by.back.smallestInsideRadius).toBeNull();
    // The back-panel groove has square ends: sharp inside corners, any bit leaves them round.
    expect(by.right.smallestInsideRadius).toBeLessThan(0.25);
    // Middle shelf: only the tenon corners, filleted in CAD.
    expect(by['Part 2'].smallestInsideRadius).toBeGreaterThan(1);
    expect(res.every(r => !r.summary.needsFlip && !r.summary.notFlat)).toBe(true);
  });

  it('besteckkasten: vert1 needs a flip, the connector is not a flat board', async () => {
    const by = Object.fromEntries((await summaries('besteckkasten')).map(r => [r.part.name, r.summary]));
    expect(by.vert1.needsFlip).toBe(true);
    expect(by.vert1.bottomDepths).toEqual([4.2]);
    expect(by.vert1.chips.find(c => c.kind === 'holes')?.count).toBe(3);
    expect(by['connector top'].notFlat).toBe(true);
    expect(by.vert2.needsFlip).toBe(false);
  });

  it('STL of the same model gives the same parts', async () => {
    const { bodies } = await loadStep(readStep('kinderregal eiche'));
    const fromStl = loadStl(toStl(bodies.map(b => b.mesh)), 'kinderregal');
    expect(fromStl).toHaveLength(6);
    const dims = (ps: ReturnType<typeof detectFlat>[]) =>
      groupIdentical(ps)
        .map(g => `${g.part.size.map(s => s.toFixed(1)).join('x')} x${g.names.length}`)
        .sort();
    expect(dims(fromStl.map(detectFlat))).toEqual(dims(bodies.map(detectFlat)));
  });

  it('flatMatrix maps the original mesh onto the flat one', async () => {
    const { bodies } = await loadStep(readStep('kinderregal eiche'));
    const part = detectFlat(bodies[0]);
    const m = flatMatrix(part);
    const p = bodies[0].mesh.positions;
    for (const i of [0, 30, 300]) {
      const [x, y, z] = [p[i * 3], p[i * 3 + 1], p[i * 3 + 2]];
      const out = [0, 1, 2].map(r => m[r] * x + m[4 + r] * y + m[8 + r] * z + m[12 + r]);
      out.forEach((v, r) => expect(v).toBeCloseTo(part.mesh.positions[i * 3 + r], 6));
    }
  });
});
