import type { ModuleStatic } from '@salusoft89/planegcs';
import { afterEach, expect, it, vi } from 'vitest';
import { addLine, createCadPart, createPlateDocument, updateDimension } from './document';

const h = vi.hoisted(() => ({ initialize: vi.fn() }));
vi.mock('@salusoft89/planegcs', async original => ({
  ...(await original<typeof import('@salusoft89/planegcs')>()),
  init_planegcs_module: h.initialize,
}));
afterEach(() => {
  vi.resetModules();
  h.initialize.mockReset();
});

it('discards a poisoned native module so the next detached solve can recover without reloading the design', async () => {
  const actual = await vi.importActual<typeof import('@salusoft89/planegcs')>('@salusoft89/planegcs');
  const good = await actual.init_planegcs_module();
  const bad: ModuleStatic = {
    ...good,
    GcsSystem: class {
      constructor() {
        throw new WebAssembly.RuntimeError('memory access out of bounds');
      }
    } as unknown as ModuleStatic['GcsSystem'],
  };
  h.initialize.mockResolvedValueOnce(bad).mockResolvedValue(good);
  const { solveCadDocument } = await import('./solver');
  const document = createPlateDocument(),
    source = structuredClone(document);
  const failed = await solveCadDocument(document);
  expect(failed.status).toBe('invalid');
  expect(document).toEqual(source);
  const recovered = await solveCadDocument(document);
  expect(recovered.status).toBe('solved');
  expect(h.initialize).toHaveBeenCalledTimes(2);
  expect(failed.diagnostics.some(diagnostic => diagnostic.code === 'solver-restarted')).toBe(true);
  expect(failed.document).toEqual(source);
});

it('keeps primary native failure atomic even after an earlier part produced changed solved geometry', async () => {
  const actual = await vi.importActual<typeof import('@salusoft89/planegcs')>('@salusoft89/planegcs');
  const good = await actual.init_planegcs_module();
  let instances = 0;
  const bad: ModuleStatic = {
    ...good,
    GcsSystem: function () {
      if (++instances === 2) throw new WebAssembly.RuntimeError('memory access out of bounds');
      return new good.GcsSystem();
    } as unknown as ModuleStatic['GcsSystem'],
  };
  h.initialize.mockResolvedValueOnce(bad).mockResolvedValue(good);
  const { solveCadDocument } = await import('./solver');
  let document = createPlateDocument({ width: 100, height: 60 });
  const width = document.parts[0]!.sketch.constraints.find(c => c.label === 'Width')!;
  document = updateDimension(document, width.id, 140);
  document.parts.push(...createPlateDocument({ width: 50, height: 30 }).parts);
  const source = structuredClone(document);
  const failed = await solveCadDocument(document, { classifyEntities: true });
  expect(failed.status).toBe('invalid');
  expect(failed.document).toEqual(source);
  expect(failed.sketches.every(s => s.status === 'invalid')).toBe(true);
  expect(failed.diagnostics.map(d => d.code)).toEqual(['solver-restarted']);
  expect((await solveCadDocument(createPlateDocument())).status).toBe('solved');
  expect(h.initialize).toHaveBeenCalledTimes(2);
});

it('isolates a classification-only abort, keeps validated geometry and solves later parts with a fresh engine', async () => {
  const actual = await vi.importActual<typeof import('@salusoft89/planegcs')>('@salusoft89/planegcs');
  const good = await actual.init_planegcs_module();
  let instances = 0;
  let trapped: InstanceType<ModuleStatic['GcsSystem']> | undefined;
  const bad: ModuleStatic & { onAbort?: (reason: unknown) => void } = {
    ...good,
    GcsSystem: function () {
      const system = new good.GcsSystem();
      if (++instances === 2) {
        trapped = system;
        const solve = system.solve_system.bind(system);
        let calls = 0;
        system.solve_system = (algorithm: number) => {
          if (++calls === 2) {
            bad.onAbort?.('OOM');
            throw new Error('Native engine stopped');
          }
          return solve(algorithm);
        };
      }
      return system;
    } as unknown as ModuleStatic['GcsSystem'],
  };
  h.initialize.mockResolvedValueOnce(bad).mockResolvedValue(good);
  const { solveCadDocument } = await import('./solver');
  let document = createPlateDocument({ width: 100, height: 60 });
  const width = document.parts[0]!.sketch.constraints.find(constraint => constraint.label === 'Width')!;
  document = updateDimension(document, width.id, 140);
  const free = createCadPart('Abort during classification');
  free.sketch = addLine(free.sketch, { x1: 10, y1: 0, x2: 20, y2: 10 });
  document.parts.push(free);
  document.parts.push(...createPlateDocument({ width: 50, height: 30 }).parts);
  const source = structuredClone(document);
  try {
    const result = await solveCadDocument(document, { classifyEntities: true });
    expect(result.sketches.every(sketch => sketch.status === 'solved')).toBe(true);
    expect(result.sketches.map(sketch => sketch.dof)).toEqual([0, 4, 0]);
    expect(result.sketches[1]!.entityAnalysis).toMatchObject({ complete: false, limitedBy: 'engine-reset' });
    expect(Object.values(result.sketches[1]!.entityStatus!).every(value => value === 'unknown')).toBe(true);
    expect(result.diagnostics.some(d => d.code === 'entity-analysis-limited' && d.severity === 'warning')).toBe(true);
    expect(result.diagnostics.some(d => d.code === 'solver-restarted')).toBe(false);
    expect(result.document.parts[0]!.sketch.entities).not.toEqual(source.parts[0]!.sketch.entities);
    expect(result.document.parts[1]!.sketch).toEqual(source.parts[1]!.sketch);
    expect(document).toEqual(source);
    expect((await solveCadDocument(createPlateDocument())).status).toBe('solved');
    expect(h.initialize).toHaveBeenCalledTimes(2);
  } finally {
    // The fixture only signals an abort; its underlying real native allocation remains healthy.
    trapped?.clear_data();
    trapped?.delete();
  }
});
