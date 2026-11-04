import { boardRequest, instancesOf, nestBoard, reconcileBoards, type BoardV1 } from '@/cam/boards';
import { camWorker } from '@/cam/camQueries';
import type { BoardRequest, PlanResult } from '@/cam/camTypes';
import { readGcode } from '@wbcnc/cam';
import { kClampWidth, kHoldDefaults, kHoldHeights, kOverHold } from '@wbcnc/cam/holdPoints';
import * as Comlink from 'comlink';
import { beforeAll, describe, expect, it } from 'vitest';
import besteckUrl from '../../../../packages/cam/test/fixtures/besteckkasten.step?url';

const kBit = 3.175;

describe('the worker: holds on a real board with a second side', () => {
  const key = 'hold-test:besteckkasten.step';
  let parts: ReturnType<typeof instancesOf>;
  let sheet: BoardV1;

  beforeAll(async () => {
    const bytes = new Uint8Array(await (await fetch(besteckUrl)).arrayBuffer());
    const model = await camWorker().importModel(Comlink.transfer(bytes, [bytes.buffer]), 'besteckkasten.step', key);
    parts = instancesOf(model.parts, () => true);
    sheet = { ...reconcileBoards(undefined, parts, 'oak')[0], size: { fit: false as const, w: 1220, h: 610 } };
  }, 120_000);

  const plan = (board: BoardV1, change: (r: BoardRequest) => BoardRequest = r => r): Promise<PlanResult> =>
    camWorker().generateBoard(key, change(boardRequest(board, nestBoard(board, parts, kBit), parts)), {
      tools: [{ number: 1, diameter: kBit }],
    });

  const programs = (p: PlanResult) => [...p.programs, ...(p.sideB?.programs ?? []), ...(p.release ?? [])];
  /** The lowest Z of any rapid that moves sideways, in any program of the job. */
  const lowestTravel = (p: PlanResult) =>
    Math.min(
      ...programs(p).flatMap(q =>
        readGcode(q.gcode)
          .filter(m => m.rapid && Math.hypot(m.to[0] - m.from[0], m.to[1] - m.from[1]) > 1e-6)
          .map(m => Math.min(m.from[2], m.to[2]))
      )
    );

  it('as suggested, with screws: not blocked, and rapids clear their heads', async () => {
    const p = await plan(sheet);
    expect(p.sideB).toBeTruthy();
    expect((p.timeline ?? []).filter(e => e.block)).toEqual([]);
    expect(p.holdClash).toEqual([]);
    expect(lowestTravel(p)).toBeGreaterThan(p.size[2] + 3);
  }, 120_000);

  it('with clamps: every program travels above them, the guided ones too, and nothing is in their way', async () => {
    // A tall clamp (a toggle or strap clamp, 30 mm above the stock).
    const board: BoardV1 = { ...sheet, holdDown: 'tabs-guided', holds: { kind: 'clamp', d: 2, w: 20, height: 30 } };
    const p = await plan(board);
    expect(p.release?.length).toBeGreaterThan(0);
    expect(p.holdClash).toEqual([]);
    expect((p.timeline ?? []).filter(e => e.block)).toEqual([]);
    expect(lowestTravel(p)).toBeGreaterThanOrEqual(p.size[2] + 30 + kOverHold);
    // The default low edge clamp, on its narrow frame, is as good a hold, and the bit still passes over it.
    const low = await plan({ ...board, holds: { kind: 'clamp', d: kHoldDefaults.clamp, w: kClampWidth } });
    expect(low.holdClash).toEqual([]);
    expect((low.timeline ?? []).filter(e => e.block)).toEqual([]);
    expect(lowestTravel(low)).toBeGreaterThanOrEqual(low.size[2] + kHoldHeights.clamp + kOverHold);
  }, 240_000);

  it('no tab lands where side B cuts', async () => {
    const p = await plan(sheet);
    const h = p.size[1];
    const cut = (p.sideB?.programs ?? []).flatMap(q =>
      readGcode(q.gcode)
        .filter(m => !m.rapid && m.to[2] < p.size[2])
        .map(m => ({ x: m.to[0], y: h - m.to[1] }))
    );
    expect(cut.length).toBeGreaterThan(0);
    for (const part of p.hold ?? [])
      for (const t of part.tabs) expect(Math.min(...cut.map(c => Math.hypot(c.x - t.at.x, c.y - t.at.y)))).toBeGreaterThan(kBit / 2);
  }, 120_000);

  it('a board meant to be held by points with none on it: blocked, whatever the parts do', async () => {
    const p = await plan(sheet, r => ({ ...r, holdPoints: [] }));
    const events = (p.timeline ?? []).filter(e => e.kind === 'board');
    expect(events).toHaveLength(1);
    expect(events[0].block).toBe(true);
    expect(events[0].message).toMatch(/Nothing holds this board/);
  }, 120_000);

  it('a clamp in the way: reported where it is on the board, from any program', async () => {
    const first = await plan(sheet);
    const [x, y] = readGcode(first.programs[0].gcode).find(m => !m.rapid && m.to[2] < first.size[2])!.to;
    const p = await plan(sheet, r => ({
      ...r,
      holdPoints: [...(r.holdPoints ?? []), { x, y, kind: 'clamp', d: 10, w: 10, dir: { x: 0, y: 1 } }],
    }));
    expect(p.holdClash).toContainEqual({ x, y });
  }, 120_000);
});
