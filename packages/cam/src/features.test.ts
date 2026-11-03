import { describe, expect, it } from 'vitest';
import { extractFeatures } from './features';
import { readStep } from './fixtures';
import { bounds2 } from './geom';
import { detectFlat, loadStep } from './import';

const fmtB = (b: ReturnType<typeof bounds2>) => `[${b.minX.toFixed(2)},${b.minY.toFixed(2)}]-[${b.maxX.toFixed(2)},${b.maxY.toFixed(2)}]`;

async function analyze(file: string) {
  const { bodies } = await loadStep(readStep(file));
  return bodies.map(b => {
    const part = detectFlat(b);
    const t0 = performance.now();
    const f = extractFeatures(part.mesh, part.thickness);
    const ms = performance.now() - t0;
    console.log(
      `${file} / ${part.name}: ${ms.toFixed(0)}ms levels ${f.levels.map(l => `${l.z}(${l.area.toFixed(0)})`).join(' ')} ` +
        `outlines ${f.outlines.length} (${f.outlines.map(o => o.length).join(',')} pts) holes ${f.throughHoles.length} sloped ${f.slopedArea.toFixed(0)}mm²` +
        (f.bottomFaces.length ? ` BOTTOM ${f.bottomFaces.map(b => `${b.z}(${b.area.toFixed(0)})`).join(' ')}` : '')
    );
    for (const p of f.pockets)
      console.log(
        `   pocket z=${p.floorZ} area ${p.area.toFixed(0)}mm² in ${p.strictRegion.length} loops, strict ${p.strictRegion.map(r => fmtB(bounds2([r]))).join(' ')}`
      );
    return { part, f };
  });
}

describe('spike 2: 2.5D features', () => {
  it('kinderregal: mortises at 3.8 + rabbet at 3.5 on the sides, rabbet on top/bottom shelves, plain back', async () => {
    const res = await analyze('kinderregal eiche');
    const byName = Object.fromEntries(res.map(r => [r.part.name, r.f]));
    expect(byName.left.pockets.map(p => p.floorZ)).toEqual([3.8, 3.5]);
    expect(byName.right.pockets.map(p => p.floorZ)).toEqual([3.8, 3.5]);
    expect(byName.left.pockets[0].strictRegion).toHaveLength(10);
    expect(byName['Part 1'].pockets.map(p => p.floorZ)).toEqual([3.5]);
    expect(byName['Part 2'].pockets).toHaveLength(0);
    expect(byName.back.pockets).toHaveLength(0);
    for (const r of res) {
      expect(r.f.outlines).toHaveLength(1);
      expect(r.f.bottomFaces).toHaveLength(0);
    }
  });

  it('besteckkasten: reports bottom-side features', async () => {
    const res = await analyze('besteckkasten');
    expect(res.some(r => r.f.bottomFaces.length > 0)).toBe(true);
  });

  it('messerblock klein: curved knife slots are not 2.5D and get flagged before feature extraction', async () => {
    // 350k triangles; extracting features from it takes ~30s, which is why the app should stop at this check.
    const { bodies } = await loadStep(readStep('messerblock klein'));
    const part = detectFlat(bodies[0]);
    expect(part.prismaticRatio).toBeLessThan(0.9);
  });
});
