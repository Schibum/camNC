import { beforeAll, describe, expect, it } from 'vitest';
import { readGcode, type Move } from './analyze';
import { boardBits, camBoard, orderBoardQueue, partToBoard, splitByBit, type BoardPart, type BoardSpec, type HoldDown } from './board';
import { extractFeatures, type PartFeatures } from './features';
import { difference } from './geom';
import { readStep } from './fixtures';
import { toGcode } from './gcode';
import { detectFlat, loadStep } from './import';
import { nestRects, placedSize } from './nest';
import { checkGcodeSafety } from './safety';
import { DEFAULT_SETTINGS, DEFAULT_TABS, type PartCam, type Tool } from './toolpaths';

interface Part {
  name: string;
  size: [number, number, number];
  features: PartFeatures;
}

const T6: Tool = { number: 1, diameter: 6, name: 'flat end mill 6' };
const T3: Tool = { number: 2, diameter: 3.175, name: 'flat end mill 1/8"' };

let parts: Part[] = [];

beforeAll(async () => {
  const { bodies } = await loadStep(readStep('kinderregal eiche'));
  parts = bodies
    .map(detectFlat)
    .filter(p => Math.abs(p.thickness - 8) < 0.01)
    .map(p => ({ name: p.name, size: p.size, features: extractFeatures(p.mesh, p.thickness) }));
});

/** Nest the parts on one fitted board and turn the result into a BoardSpec. */
function nestBoard(
  ps: Part[],
  opts: { gap: number; holdDown?: HoldDown; canRotate?: boolean; board?: { w: number; h: number } }
): BoardSpec {
  const res = nestRects(
    ps.map(p => ({ id: p.name, w: p.size[0], h: p.size[1], canRotate: opts.canRotate })),
    { gap: opts.gap, margin: 20, board: opts.board }
  );
  expect(res.unplaced).toEqual([]);
  return {
    id: 'b1',
    name: 'Board 1',
    w: res.board.w,
    h: res.board.h,
    thickness: 8,
    holdDown: opts.holdDown ?? 'fixture-tape',
    parts: res.placements.map(pl => {
      const p = ps.find(q => q.name === pl.id)!;
      return { id: p.name, name: p.name, features: p.features, size: p.size, x: pl.x, y: pl.y, rotated: pl.rotated };
    }),
  };
}

/** The moves of each operation of a board program, split at the `(OP i/n ...)` markers. */
function movesByOp(gcode: string): Move[][] {
  const lines = gcode.split('\n');
  const markers = lines.flatMap((l, i) => (l.startsWith('(OP ') ? [i] : []));
  const all = readGcode(gcode);
  // Moves before line k: readGcode is a pure scan, so a prefix gives the move count up to there.
  const countBefore = (k: number) => readGcode(lines.slice(0, k).join('\n')).length;
  const starts = [...markers.map(countBefore), all.length];
  return markers.map((_, i) => all.slice(starts[i], starts[i + 1]));
}

/** The placement rectangle of a part (turned parts swap width and height). */
function placedRect(p: BoardPart) {
  const { w, h } = placedSize({ id: p.id, w: p.size[0], h: p.size[1] }, p.rotated);
  return { x: p.x, y: p.y, w, h };
}

/** Every cutting move stays within its own part's rectangle grown by bit radius + 1.5, and within the board. */
function expectMovesInsideParts(board: BoardSpec, cam: PartCam, gcode: string) {
  const byOp = movesByOp(gcode);
  expect(byOp).toHaveLength(cam.operations.length);
  cam.operations.forEach((op, i) => {
    const part = board.parts.find(p => op.name.startsWith(`${p.name}: `))!;
    expect(part, op.name).toBeDefined();
    const r = placedRect(part);
    const reach = op.tool.diameter / 2 + 1.5;
    const cuts = byOp[i].filter(m => !m.rapid && Math.min(m.from[2], m.to[2]) < board.thickness);
    expect(cuts.length, op.name).toBeGreaterThan(0);
    for (const m of cuts)
      for (const [x, y] of [m.from, m.to]) {
        const where = `${op.name}: (${x}, ${y}) vs ${JSON.stringify(r)}`;
        expect(x >= r.x - reach && x <= r.x + r.w + reach && y >= r.y - reach && y <= r.y + r.h + reach, where).toBe(true);
        expect(x >= -reach && x <= board.w + reach && y >= -reach && y <= board.h + reach, where).toBe(true);
      }
  });
}

function expectOpOrder(cam: PartCam) {
  const ops = cam.operations;
  for (let i = 1; i < ops.length; i++) {
    const [a, b] = [ops[i - 1], ops[i]];
    // Smallest bit first, each bit once.
    expect(b.tool.diameter, `${a.name} -> ${b.name}`).toBeGreaterThanOrEqual(a.tool.diameter);
    // Within a bit: no pocket or hole after an outline.
    if (a.tool.diameter === b.tool.diameter && a.feature === 'outline') expect(b.feature, `${a.name} -> ${b.name}`).toBe('outline');
  }
}

const safety = (board: BoardSpec, gcode: string, toolRadius: number) =>
  checkGcodeSafety(gcode, {
    stockTop: board.thickness,
    size: [board.w, board.h],
    minZ: DEFAULT_SETTINGS.finalZ,
    toolRadius,
  });

const bitSwaps = (gcode: string) => gcode.split('\n').filter(l => l.startsWith('M0 (MSG Spindle OFF. Change to'));

describe('board programs (kinderregal eiche, 8 mm parts)', () => {
  it('has the five 8 mm parts', () => {
    expect(parts.map(p => p.name).sort()).toEqual(['Part 1', 'Part 2', 'Part 3', 'left', 'right']);
  });

  it.each(['fixture-tape', 'tabs', 'skin'] as const)(
    'one bit, hold-down %s: inner features first, safe, every cut on its own part',
    holdDown => {
      // Tabs need a gap that leaves a strip between the cuts that holds them.
      const board = nestBoard(parts, { gap: holdDown === 'tabs' ? 10 : 7, holdDown });
      const cam = camBoard(board, {});
      expect(boardBits(cam)).toEqual([3.175]);
      expectOpOrder(cam);
      // Every part's outline is cut, after all pockets.
      const outlines = cam.operations.filter(o => o.feature === 'outline');
      expect(outlines).toHaveLength(5);
      const firstOutline = cam.operations.findIndex(o => o.feature === 'outline');
      expect(cam.operations.slice(firstOutline).every(o => o.feature === 'outline')).toBe(true);
      expect(cam.operations.slice(0, firstOutline).length).toBeGreaterThan(0);
      if (holdDown === 'tabs') {
        // Tabs: the final outline passes rise to the tab height.
        for (const o of outlines)
          expect(
            o.passes.at(-1)!.pts.some(p => p[2] === DEFAULT_TABS.height),
            o.name
          ).toBe(true);
      }
      if (holdDown === 'skin')
        // A 1 mm bottom skin under every part, all the way round.
        for (const o of outlines) expect(Math.min(...o.passes.at(-1)!.pts.map(p => p[2])), o.name).toBe(1);
      const gcode = toGcode(cam, { partName: board.name, stockSize: [board.w, board.h, board.thickness] });
      expect(bitSwaps(gcode)).toHaveLength(0);
      expect(safety(board, gcode, 3.175 / 2)).toEqual([]);
      expectMovesInsideParts(board, cam, gcode);
    }
  );

  it('two bits: one program per bit, smallest bit first, inner features before outlines per bit', () => {
    // The kinderregal pockets all take the 6 mm bit: give the middle shelf a 4 mm wide slot only the 1/8" bit fits.
    const withSlot = parts.map(p => {
      if (p.name !== 'Part 2') return p;
      const slot = [
        { x: 100, y: 60 },
        { x: 180, y: 60 },
        { x: 180, y: 64 },
        { x: 100, y: 64 },
      ];
      const f = p.features;
      const features: PartFeatures = {
        ...f,
        levels: [...f.levels, { z: 4, region: [slot], area: 320 }],
        pockets: [...f.pockets, { floorZ: 4, region: [slot], strictRegion: [slot], above: difference(f.outlines, [slot]), area: 320 }],
      };
      return { ...p, features };
    });
    const board = nestBoard(withSlot, { gap: 6 + 4 });
    const cam = camBoard(board, { tools: [T6, T3] });
    const bits = boardBits(cam);
    expect(bits).toEqual([3.175, 6]);
    expect(cam.operations.filter(o => o.tool === T3).map(o => o.name)).toEqual(['Part 2: Pocket 1 z=4']);
    expectOpOrder(cam);
    expect(cam.operations.filter(o => o.tool === T3).every(o => o.feature !== 'outline')).toBe(true);
    const programs = splitByBit(cam);
    expect(programs.map(p => boardBits(p))).toEqual([[3.175], [6]]);
    for (const p of programs) {
      const gcode = toGcode(p, { partName: board.name });
      expect(bitSwaps(gcode)).toEqual([]);
      expect(safety(board, gcode, 3)).toEqual([]);
      expectMovesInsideParts(board, p, gcode);
    }
  });

  it('turned parts: outline inside the placement rectangle, cuts stay on the part', () => {
    // A narrow board: the long parts only fit turned.
    const ps = parts.filter(p => p.name === 'left' || p.name === 'Part 2');
    const board = nestBoard(ps, { gap: 7, canRotate: true, board: { w: 200, h: 1100 } });
    expect(board.parts.every(p => p.rotated)).toBe(true);
    for (const p of board.parts) {
      const r = placedRect(p);
      expect(r).toEqual({ x: p.x, y: p.y, w: p.size[1], h: p.size[0] });
      for (const q of p.features.outlines.flat()) {
        const [x, y] = partToBoard(p, [q.x, q.y, 0]);
        expect(x).toBeGreaterThanOrEqual(r.x - 1e-6);
        expect(x).toBeLessThanOrEqual(r.x + r.w + 1e-6);
        expect(y).toBeGreaterThanOrEqual(r.y - 1e-6);
        expect(y).toBeLessThanOrEqual(r.y + r.h + 1e-6);
      }
    }
    const cam = camBoard(board, {});
    const gcode = toGcode(cam);
    expect(safety(board, gcode, 3.175 / 2)).toEqual([]);
    expectMovesInsideParts(board, cam, gcode);
  });
});

describe('orderBoardQueue', () => {
  /** Bit swaps for a queue, starting with `start` in the collet: between boards and inside each board. */
  const swaps = (queue: { bits: number[] }[], start: number) => {
    let bit = start,
      n = 0;
    for (const b of queue)
      for (const d of b.bits) {
        if (d !== bit) n++;
        bit = d;
      }
    return n;
  };

  it('reuses the bit in the collet from board to board', () => {
    const boards = [[3.175], [6, 3.175], [3.175, 6], [6]].map((bits, i) => ({ id: i, bits }));
    const queue = orderBoardQueue(boards, 3.175);
    expect(queue.map(b => b.id)).toEqual([0, 2, 3, 1]);
    // Naive order: 3.175 | 6 3.175 | 3.175 6 | 6 -> 3 swaps; reordered: 3.175 | 3.175 6 | 6 | 6 3.175 -> 2.
    expect(swaps(boards, 3.175)).toBe(3);
    expect(swaps(queue, 3.175)).toBe(2);
    // Every board exactly once.
    expect(queue.map(b => b.id).sort()).toEqual([0, 1, 2, 3]);
  });

  it('starts with the smallest bit when none is given, and handles an empty queue', () => {
    expect(orderBoardQueue([{ bits: [6] }, { bits: [3.175] }]).map(b => b.bits[0])).toEqual([3.175, 6]);
    expect(orderBoardQueue([])).toEqual([]);
  });
});
