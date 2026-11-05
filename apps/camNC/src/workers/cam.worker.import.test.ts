import type { StepBody } from '@wbcnc/cam';
import { describe, expect, it, vi } from 'vitest';
import type { CamWorkerAPI } from './cam.worker';

const worker = vi.hoisted(() => ({ api: undefined as CamWorkerAPI | undefined, bodies: [] as StepBody[] }));
vi.mock('comlink', () => ({
  expose: (api: CamWorkerAPI) => {
    worker.api = api;
  },
  transfer: <T>(value: T) => value,
}));
vi.mock('@wbcnc/cam', async importOriginal => ({
  ...(await importOriginal<typeof import('@wbcnc/cam')>()),
  loadStep: async () => ({ bodies: worker.bodies, initMs: 0, readMs: 0 }),
}));
import './cam.worker';

/** Same-named, closed boards with identical XY tessellation but different pocket floors. */
function pocketedBoard(floor: number): StepBody {
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
  return {
    name: 'Part',
    mesh: {
      positions,
      indices: Uint32Array.from(indices),
      faceRanges: Array.from({ length: indices.length / 3 }, (_, i) => ({ first: i, last: i })),
    },
  };
}

describe('imported body meshes', () => {
  it('belong to their geometric group when same-named shallow and deep bodies are interleaved', async () => {
    worker.bodies = [pocketedBoard(5), pocketedBoard(2), pocketedBoard(5)];
    const model = await worker.api!.importModel(new Uint8Array(), 'same-named.step', 'same-named');
    expect(model.parts.map(p => p.names.length)).toEqual([2, 1]);
    expect(model.parts.map(p => p.shape.pockets.map(pocket => pocket.depth))).toEqual([[3], [6]]);
    expect(model.meshes.map(mesh => mesh.partId)).toEqual(['part-0', 'part-1', 'part-0']);
    for (const [i, mesh] of model.meshes.entries()) expect(mesh.positions).toEqual(Float32Array.from(worker.bodies[i].mesh.positions));
  });
});
