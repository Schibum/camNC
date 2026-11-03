import { describe, expect, it } from 'vitest';
import { camBoard, type BoardSpec } from './board';
import { extractFeatures, type PartFeatures } from './features';
import { readStep } from './fixtures';
import { holdCheck } from './hold';
import { detectFlat, loadStep } from './import';
import { nestRects } from './nest';
import { DEFAULT_TABS } from './toolpaths';

const rect = (x0: number, y0: number, x1: number, y1: number) => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];

/** A plain 200 x 100 x 8 part. */
function plain(): PartFeatures {
  const outline = rect(0, 0, 200, 100);
  return {
    thickness: 8,
    footprint: [outline],
    outlines: [outline],
    throughHoles: [],
    levels: [],
    pockets: [],
    bottomFaces: [],
    slopedArea: 0,
  };
}

const spec = (parts: BoardSpec['parts'], w: number, h: number): BoardSpec => ({
  id: 'a',
  name: 'A',
  w,
  h,
  thickness: 8,
  holdDown: 'tabs',
  tabs: DEFAULT_TABS,
  parts,
});

describe('do the tabs hold?', () => {
  it('a part with room around it: every tab reaches stock that is fixed to the board', () => {
    const board = spec([{ id: 'p', name: 'side', features: plain(), size: [200, 100, 8], x: 30, y: 30, rotated: false }], 260, 160);
    const [hold] = holdCheck(camBoard(board, {}), board);
    expect(hold.part).toBe('side');
    expect(hold.tabs.length).toBeGreaterThanOrEqual(3);
    expect(hold.anchored).toBe(hold.tabs.length);
    expect(hold.ok).toBe(true);
  });

  it('tabs into the sliver between two neighbouring cuts or a narrow edge strip hold nothing', () => {
    // Two parts 8 mm apart (bit + 4 + a hair) and 5.2 mm from the edge: after both cuts, 1.65 mm and 2 mm strips.
    const parts: BoardSpec['parts'] = [
      { id: 'a', name: 'a', features: plain(), size: [200, 100, 8], x: 5.2, y: 5.2, rotated: false },
      { id: 'b', name: 'b', features: plain(), size: [200, 100, 8], x: 5.2, y: 113.2, rotated: false },
    ];
    // "Tabs anyway": where they'd go without looking (the fallback when there's no spot that holds).
    const board = { ...spec(parts, 210.4, 218.4), tabFallback: 'tabs' as const };
    const holds = holdCheck(camBoard(board, {}), board);
    expect(holds).toHaveLength(2);
    for (const h of holds) {
      expect(h.tabs.length).toBeGreaterThan(0);
      expect(h.anchored).toBe(0);
      expect(h.ok).toBe(false);
    }
    // The same parts with 20 mm all round hold.
    const roomy = spec(
      parts.map((p, i) => ({ ...p, x: 20, y: 20 + i * 140 })),
      240,
      280
    );
    expect(holdCheck(camBoard(roomy, {}), roomy).every(h => h.ok)).toBe(true);
  });

  it('kinderregal board A as nested by default (gap 8, margin 5.2): tabs only where they hold, every part held', async () => {
    const bodies = (await loadStep(readStep('kinderregal eiche'))).bodies.map(detectFlat).filter(p => Math.abs(p.thickness - 8) < 0.5);
    const items = bodies.map(b => ({ id: b.name, w: b.size[0], h: b.size[1] }));
    const nest = nestRects(items, { gap: 8, margin: 5.2 });
    const parts: BoardSpec['parts'] = nest.placements.map(p => {
      const b = bodies.find(x => x.name === p.id)!;
      return { id: p.id, name: p.id, features: extractFeatures(b.mesh, b.thickness), size: b.size, x: p.x, y: p.y, rotated: p.rotated };
    });
    const board = spec(parts, nest.board.w, nest.board.h);
    const holds = holdCheck(camBoard(board, {}), board);
    console.info(holds.map(h => `${h.part}: ${h.anchored}/${h.tabs.length} tabs hold`).join(', '));
    expect(holds).toHaveLength(5);
    expect(holds.every(h => h.ok && h.anchored === h.tabs.length)).toBe(true);
  }, 120_000);
});
