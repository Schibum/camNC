import {
  boardRequest,
  instancesOf,
  nestBoard,
  reconcileBoards,
  suggestFixtures,
  withLayout,
  type BoardV1,
  type NestOptions,
} from '@/cam/boards';
import { camWorker } from '@/cam/camQueries';
import type { BoardRequest, PlanResult } from '@/cam/camTypes';
import { readGcode } from '@wbcnc/cam';
import { kHoldHeights, kOverHold } from '@wbcnc/cam/holdPoints';
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

  const plan = (board: BoardV1, change: (r: BoardRequest) => BoardRequest = r => r, opts: NestOptions = {}): Promise<PlanResult> =>
    camWorker().generateBoard(key, change(boardRequest(board, nestBoard(board, parts, kBit, opts), parts)), {
      tools: [{ number: 1, diameter: kBit }],
    });

  /** Suggested clamps, as the Boards step's button places them. */
  const held = (board: BoardV1, opts: NestOptions = {}) =>
    suggestFixtures(withLayout(board, nestBoard(board, parts, kBit, opts)), parts, kBit, opts);

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

  it('with suggested clamps: not blocked, and rapids clear them', async () => {
    const p = await plan(held(sheet));
    expect(p.sideB).toBeTruthy();
    expect((p.timeline ?? []).filter(e => e.block)).toEqual([]);
    expect(p.holdClash).toEqual([]);
    expect(lowestTravel(p)).toBeGreaterThan(p.size[2] + kHoldHeights.clamp);
  }, 120_000);

  it('with clamps: every program travels above them, the guided ones too, and nothing is in their way', async () => {
    // A tall clamp (a toggle or strap clamp, 30 mm above the stock).
    const hardware = { clamp: { d: 2, w: 20, height: 30 }, screw: { d: 10, height: 3 } };
    const guided: BoardV1 = { ...sheet, guidedTabs: true };
    const p = await plan(held(guided, { hardware }), undefined, { hardware });
    expect(p.release?.length).toBeGreaterThan(0);
    expect(p.holdClash).toEqual([]);
    expect((p.timeline ?? []).filter(e => e.block)).toEqual([]);
    expect(lowestTravel(p)).toBeGreaterThanOrEqual(p.size[2] + 30 + kOverHold);
    // The default low edge clamp is as good a hold, and the bit still passes over it.
    const low = await plan(held(guided));
    expect(low.holdClash).toEqual([]);
    expect((low.timeline ?? []).filter(e => e.block)).toEqual([]);
    expect(lowestTravel(low)).toBeGreaterThanOrEqual(low.size[2] + kHoldHeights.clamp + kOverHold);
  }, 240_000);

  it('the spindle switched by the controller: every program of the board, guided ones too, says nothing of a manual spindle', async () => {
    const board: BoardV1 = { ...sheet, guidedTabs: true };
    const request = boardRequest(board, nestBoard(board, parts, kBit), parts);
    const tools = [{ number: 1, diameter: kBit }];
    const hand = await camWorker().generateBoard(key, request, { tools });
    const controller = await camWorker().generateBoard(key, request, { tools, spindle: 'controller' });
    expect(programs(hand).every(q => q.gcode.includes('Manual spindle'))).toBe(true);
    expect(programs(controller).length).toBe(programs(hand).length);
    for (const q of programs(controller)) expect(q.gcode).not.toContain('Manual spindle');
  }, 120_000);

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

  it('a board with nothing fastening it: said once, and not blocked (tape, or a hand on it)', async () => {
    const p = await plan(sheet);
    const events = p.timeline ?? [];
    expect(events.filter(e => e.kind === 'board')).toHaveLength(1);
    expect(events.filter(e => e.kind === 'pivot')).toEqual([]);
    expect(events.find(e => e.kind === 'board')!.message).toMatch(/Nothing fastens this board/);
    expect(events.filter(e => e.block)).toEqual([]);
  }, 120_000);

  it('a piece that can turn is said, not blocked; the job goes on', async () => {
    const one = { ...sheet, fixtures: [{ kind: 'clamp' as const, side: 'right' as const, at: 300 }] };
    const p = await plan(one);
    const events = p.timeline ?? [];
    expect(events.find(e => e.kind === 'board')!.message).toMatch(/only 1 screw or clamp around its middle/);
    expect(events.filter(e => e.block)).toEqual([]);
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
