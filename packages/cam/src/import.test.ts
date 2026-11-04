import { statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { readStep } from './fixtures';
import { detectFlat, groupIdentical, loadStep } from './import';

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
