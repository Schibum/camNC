import type { PartFeatures } from './features';
import type { Vec3 } from './geom';
import { camPart, DEFAULT_TABS, type CamSettings, type Operation, type PartCam, type TabSettings } from './toolpaths';

/** How the board is held down while cutting; decides tabs and clamp keep-outs. */
export type HoldDown = 'fixture-tape' | 'tabs' | 'tabs-guided' | 'clamps';

export interface BoardPart {
  /** Unique on the board (one per body: two identical shelves are two parts). */
  id: string;
  name: string;
  features: PartFeatures;
  /** Part size laid flat (before turning). */
  size: Vec3;
  /** Lower left corner on the board, and whether the part is turned 90° counterclockwise. */
  x: number;
  y: number;
  rotated: boolean;
}

export interface BoardSpec {
  id: string;
  name: string;
  w: number;
  h: number;
  thickness: number;
  holdDown: HoldDown;
  tabs?: TabSettings;
  parts: BoardPart[];
}

/** Tabs for hold-downs that use them. */
export const usesTabs = (holdDown: HoldDown) => holdDown === 'tabs' || holdDown === 'tabs-guided';

/** Part coordinates (0..w, 0..h, laid flat) to board coordinates. */
export function partToBoard(p: Pick<BoardPart, 'x' | 'y' | 'rotated' | 'size'>, q: Vec3): Vec3 {
  return p.rotated ? [p.x + p.size[1] - q[1], p.y + q[0], q[2]] : [p.x + q[0], p.y + q[1], q[2]];
}

const kFeatureOrder = { pocket: 0, hole: 1, outline: 2 } as const;

/**
 * One program for a whole board: operations grouped by bit (smallest first, so the swap happens once per bit), and
 * per bit inner features (pockets, holes) of every part before any outline, so no part comes loose while others are
 * still cut. Parts follow each other nearest-first.
 */
export function camBoard(board: BoardSpec, settings: Partial<CamSettings>): PartCam {
  const tabs = usesTabs(board.holdDown) ? (board.tabs ?? DEFAULT_TABS) : false;
  const warnings: string[] = [];
  const ops: { op: Operation; part: BoardPart; index: number }[] = [];
  for (const part of board.parts) {
    const cam = camPart(part.features, { ...settings, tabs });
    warnings.push(...cam.warnings.map(w => `${part.name}: ${w}`));
    cam.operations.forEach((op, index) =>
      ops.push({
        op: {
          ...op,
          name: `${part.name}: ${op.name}`,
          passes: op.passes.map(p => ({ ...p, pts: p.pts.map(q => partToBoard(part, q)) })),
        },
        part,
        index,
      })
    );
  }
  const diameters = [...new Set(ops.map(o => o.op.tool.diameter))].sort((a, b) => a - b);
  const operations: Operation[] = [];
  let pos = { x: 0, y: 0 };
  for (const d of diameters) {
    for (const stage of ['inner', 'outline'] as const) {
      const group = ops.filter(o => o.op.tool.diameter === d && (o.op.feature === 'outline') === (stage === 'outline'));
      // Nearest part next; a part's own operations keep their order (deeper pockets start at the floor above).
      const left = [...new Set(group.map(o => o.part))];
      while (left.length) {
        let bi = 0,
          bd = Infinity;
        left.forEach((p, i) => {
          const c = partToBoard(p, [p.size[0] / 2, p.size[1] / 2, 0]);
          const dd = (c[0] - pos.x) ** 2 + (c[1] - pos.y) ** 2;
          if (dd < bd) {
            bd = dd;
            bi = i;
          }
        });
        const [part] = left.splice(bi, 1);
        const mine = group
          .filter(o => o.part === part)
          .sort((a, b) => kFeatureOrder[a.op.feature] - kFeatureOrder[b.op.feature] || a.index - b.index);
        operations.push(...mine.map(o => o.op));
        const last = mine.at(-1)?.op.passes.at(-1)?.pts.at(-1);
        if (last) pos = { x: last[0], y: last[1] };
      }
    }
  }
  return { stockTop: board.thickness, operations, warnings };
}

/** Bits in the order a board program uses them. */
export const boardBits = (cam: PartCam) =>
  cam.operations.reduce<number[]>((bits, op) => (bits.at(-1) === op.tool.diameter ? bits : [...bits, op.tool.diameter]), []);

/**
 * Board queue that reuses the bit in the collet: start with boards whose first bit is `startBit` (or the smallest),
 * and after each board pick one that starts with the bit the last one ended with. Stable otherwise.
 */
export function orderBoardQueue<T extends { bits: number[] }>(boards: T[], startBit?: number): T[] {
  const left = [...boards];
  const out: T[] = [];
  let bit = startBit ?? Math.min(...boards.flatMap(b => b.bits.slice(0, 1)));
  while (left.length) {
    const i = Math.max(
      0,
      left.findIndex(b => b.bits[0] === bit)
    );
    const [next] = left.splice(i, 1);
    out.push(next);
    bit = next.bits.at(-1) ?? bit;
  }
  return out;
}
