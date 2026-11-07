import { boardRequest, instancesOf, nestBoard, reconcileBoards, type BoardV1 } from '@/cam/boards';
import { camWorker } from '@/cam/camQueries';
import type { BoardRequest, ModelImport } from '@/cam/camTypes';
import { readGcode } from '@wbcnc/cam';
import * as Comlink from 'comlink';
import { beforeAll, describe, expect, it } from 'vitest';
import besteckUrl from '../../../../packages/cam/test/fixtures/besteckkasten.step?url';
import stepUrl from '../../../../packages/cam/test/fixtures/kinderregal-eiche.step?url';

async function importModel(url: string, key: string) {
  const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer());
  return camWorker().importModel(Comlink.transfer(bytes, [bytes.buffer]), `${key}.step`, key);
}

/** The model's first board with enough parts, changed, as the Plan step would ask for it. */
function request(model: ModelImport, change: (b: BoardV1) => BoardV1): BoardRequest {
  const instances = instancesOf(model.parts, () => true);
  const boards = reconcileBoards(undefined, instances, 'oak').map(change);
  const board = boards.find(b => b.name === 'A')!;
  return boardRequest(board, nestBoard(board, instances, 3.175), instances, {});
}

const settings = {};
const moves = (gcode: string) => readGcode(gcode).filter(m => !m.rapid);

/** A binary STL: a flat ring, thickness `t`, outer and hole radius in mm. */
function ringStl(outer: number, hole: number, t: number) {
  const n = 96;
  const on = (r: number, i: number, z: number) => [r * Math.cos((i / n) * 2 * Math.PI), r * Math.sin((i / n) * 2 * Math.PI), z];
  const quad = (a: number[], b: number[], c: number[], d: number[]) => [a, b, c, a, c, d];
  const corners = Array.from({ length: n }, (_, i) => [
    ...quad(on(hole, i, t), on(outer, i, t), on(outer, i + 1, t), on(hole, i + 1, t)),
    ...quad(on(hole, i, 0), on(hole, i + 1, 0), on(outer, i + 1, 0), on(outer, i, 0)),
    ...quad(on(outer, i, 0), on(outer, i + 1, 0), on(outer, i + 1, t), on(outer, i, t)),
    ...quad(on(hole, i + 1, 0), on(hole, i, 0), on(hole, i, t), on(hole, i + 1, t)),
  ]).flat();
  const triangles = corners.length / 3;
  const bytes = new Uint8Array(84 + triangles * 50);
  const view = new DataView(bytes.buffer);
  view.setUint32(80, triangles, true);
  corners.forEach((corner, i) => {
    const at = 84 + Math.floor(i / 3) * 50 + 12 + (i % 3) * 12;
    corner.forEach((v, k) => view.setFloat32(at + k * 4, v, true));
  });
  return bytes;
}

describe('programs of a big hole to clear', () => {
  it('summarize more points than fit on the call stack', async () => {
    const bytes = ringStl(280, 100, 18);
    const model = await camWorker().importModel(Comlink.transfer(bytes, [bytes.buffer]), 'worker-ring.stl', 'worker-ring');
    const instances = instancesOf(model.parts, () => true);
    const board = reconcileBoards(undefined, instances, 'oak').find(b => b.name === 'A')!;
    const clear = boardRequest(board, nestBoard(board, instances, 3.175), instances, {
      holes: { [instances[0].partId]: { 0: 'clear' } },
    });
    const plan = await camWorker().generateBoard('worker-ring', clear, settings);
    expect(plan.holeMiddles?.map(m => m.state)).toEqual(['cleared']);
    const middle = plan.ops.find(op => op.name.includes('middle'))!;
    expect(middle.zBottom).toBeCloseTo(-0.3);
    expect(plan.safety).toEqual([]);
  }, 120_000);
});

describe('programs for boards lying askew', () => {
  let shelf: ModelImport;
  let box: ModelImport;
  beforeAll(async () => {
    shelf = await importModel(stepUrl, 'worker-shelf');
    box = await importModel(besteckUrl, 'worker-box');
  }, 120_000);

  it('pass the checks when turned: side A and the guided programs, each against the turned rectangle', async () => {
    const straight = request(shelf, b => ({ ...b, guidedTabs: true }));
    const turned = await camWorker().generateBoard('worker-shelf', { ...straight, rotationDeg: 10 }, settings);
    expect(turned.safety).toEqual([]);
    expect(turned.programs[0].timing).toMatchObject({ profileId: 'lowrider-v4-reference', profileProvenance: 'reference' });
    expect(turned.programs[0].timeMin).toBe(turned.programs[0].timing!.estimatedAutomaticSeconds / 60);
    expect(turned.programs[0].timing!.manualPauseCount).toBeGreaterThan(0);
    expect(turned.programs[0].timing!.motionEstimateSeconds).toBeGreaterThanOrEqual(turned.programs[0].timing!.motionLowerBoundSeconds);
    expect(turned.programs[0].gcode).toContain(`(Plan: ${turned.programs[0].setup!.planFingerprint})`);
    expect(turned.programs[0].setupSheet).toContain('Z0: stock bottom');
    for (const release of turned.release ?? []) {
      expect(release.gcode).toContain(`(Plan: ${release.setup!.planFingerprint})`);
      expect(release.setup!.accuracy).toBeDefined();
      const footprint = release.setup!.blankFootprint!.flat();
      expect(Math.min(...footprint.map(point => point[0]))).toBeLessThan(0);
    }
    expect(turned.release?.length).toBeGreaterThan(0);
    for (const r of turned.release!) expect(r.safety).toEqual([]);
    // It really is turned: the program reaches past the straight board, the check above would have failed on it.
    const flat = await camWorker().generateBoard('worker-shelf', straight, settings);
    const reach = (g: string) => Math.max(...moves(g).map(m => m.to[1]));
    expect(reach(turned.programs[0].gcode)).toBeGreaterThan(reach(flat.programs[0].gcode) + 5);
  }, 120_000);

  it('side B lies at its own angle when corrected, and what runs turned over goes with it; side A stays', async () => {
    const straight = request(box, b => ({ ...b, flip: 'camera', guidedTabs: true }) as BoardV1);
    const asA = await camWorker().generateBoard('worker-box', { ...straight, rotationDeg: 1 }, settings);
    expect(asA.sideB).toBeTruthy();
    const corrected = await camWorker().generateBoard('worker-box', { ...straight, rotationDeg: 1, sideBRotationDeg: 3 }, settings);
    expect(corrected.programs.map(p => p.gcode)).toEqual(asA.programs.map(p => p.gcode));
    expect(corrected.sideB!.programs[0].gcode).not.toBe(asA.sideB!.programs[0].gcode);
    expect(corrected.sideB!.safety).toEqual([]);
    expect(corrected.release?.length).toBeGreaterThan(0);
    for (const r of corrected.release!) {
      expect(r.turned).toBe(true);
      expect(r.safety).toEqual([]);
      expect(r.gcode).not.toBe(asA.release!.find(x => x.kind === r.kind)!.gcode);
    }
    // Unset: side B as side A. Set to what side A has: the same programs.
    const same = await camWorker().generateBoard('worker-box', { ...straight, rotationDeg: 1, sideBRotationDeg: 1 }, settings);
    expect(same.sideB!.programs[0].gcode).toBe(asA.sideB!.programs[0].gcode);
  }, 120_000);
});
