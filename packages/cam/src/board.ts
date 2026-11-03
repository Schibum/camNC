import type { PartFeatures } from './features';
import { dowelOperations, type DowelSpec } from './flip';
import { boardToPart, kDefaultSkin, planTabs, type PartHolding, type TabFallback } from './tabPlan';
import type { Vec3 } from './geom';
import { camPart, DEFAULT_TABS, type CamSettings, type Operation, type PartCam, type TabSettings } from './toolpaths';

/**
 * How the board is held down while cutting; decides tabs, bottom skins and clamp keep-outs. `skin`: every outline
 * stops a skin above the board's bottom, and the parts are cut free one at a time at the machine.
 */
export type HoldDown = 'fixture-tape' | 'tabs' | 'tabs-guided' | 'skin' | 'clamps';

export interface BoardPart {
  /** Unique on the board (one per body: two identical shelves are two parts). */
  id: string;
  name: string;
  features: PartFeatures;
  /** Part size laid flat (before turning). */
  size: Vec3;
  /** Where its tabs can't hold: this instead of the board's fallback. */
  tabFallback?: TabFallback;
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
  /**
   * Turn the whole board (counterclockwise, degrees) about its lower left corner, the XY zero: aligning to a board that
   * lies slightly askew on the bed is built into the program.
   */
  rotationDeg?: number;
  /** Z of the stock top if thicker than the parts (allowance or measured); default the board thickness. */
  stockTop?: number;
  parts: BoardPart[];
  /** A flip on dowel pins: side A drills the pin holes (board and spoilboard) before anything else. */
  dowels?: DowelSpec;
  /** With tabs: parts without spots for tabs that hold get this, unless they have their own. Default: a bottom skin. */
  tabFallback?: TabFallback;
  /** Bottom skin thickness, mm (default 1): for the `skin` hold-down, and parts whose tabs can't hold. */
  skin?: number;
}

/** Tabs for hold-downs that use them. */
export const usesTabs = (holdDown: HoldDown) => holdDown === 'tabs' || holdDown === 'tabs-guided';

/** Part coordinates (0..w, 0..h, laid flat) to board coordinates. */
export function partToBoard(p: Pick<BoardPart, 'x' | 'y' | 'rotated' | 'size'>, q: Vec3): Vec3 {
  return p.rotated ? [p.x + p.size[1] - q[1], p.y + q[0], q[2]] : [p.x + q[0], p.y + q[1], q[2]];
}

/** Rotation about X0 Y0, counterclockwise. */
export function rotateAboutOrigin(deg: number): (q: Vec3) => Vec3 {
  if (!deg) return q => q;
  const a = (deg * Math.PI) / 180,
    c = Math.cos(a),
    s = Math.sin(a);
  return q => [q[0] * c - q[1] * s, q[0] * s + q[1] * c, q[2]];
}

const kFeatureOrder = { pocket: 0, hole: 1, outline: 2 } as const;

/**
 * One program for a whole board: operations grouped by bit (smallest first, so the swap happens once per bit), and
 * per bit inner features (pockets, holes) of every part before any outline, so no part comes loose while others are
 * still cut. Parts follow each other nearest-first.
 */
export function camBoard(board: BoardSpec, settings: Partial<CamSettings>): PartCam {
  const tabs = usesTabs(board.holdDown) ? (board.tabs ?? DEFAULT_TABS) : false;
  const stockTop = board.stockTop ?? board.thickness;
  const turn = rotateAboutOrigin(board.rotationDeg ?? 0);
  const warnings: string[] = [];
  const ops: { op: Operation; part: BoardPart; index: number }[] = [];
  // Tabs only where they hold; the other parts get their fallback (a bottom skin by default).
  const holding = tabs
    ? planTabs(board, settings)
    : board.holdDown === 'skin'
      ? new Map(board.parts.map(p => [p.id, { id: p.id, name: p.name, how: 'skin' as const, tabs: [] }]))
      : undefined;
  for (const part of board.parts) {
    const h = holding?.get(part.id);
    const own: Partial<CamSettings> =
      h?.how === 'placed' && tabs
        ? { tabs: { ...tabs, centers: h.tabs.map(q => boardToPart(part, q)) } }
        : h?.how === 'skin'
          ? { tabs: false, outlineFloor: board.skin ?? kDefaultSkin }
          : h?.how === 'self'
            ? { tabs: false }
            : {};
    const cam = camPart(part.features, { ...settings, tabs, stockTop, ...own });
    warnings.push(...cam.warnings.map(w => `${part.name}: ${w}`));
    cam.operations.forEach((op, index) =>
      ops.push({
        op: {
          ...op,
          name: `${part.name}: ${op.name}`,
          passes: op.passes.map(p => ({ ...p, pts: p.pts.map(q => turn(partToBoard(part, q))) })),
        },
        part,
        index,
      })
    );
  }
  const diameters = [...new Set(ops.map(o => o.op.tool.diameter))].sort((a, b) => a - b);
  const operations: Operation[] = [];
  // Pin holes first, with the first bit: the board is still whole.
  if (board.dowels)
    operations.push(
      ...dowelOperations(board, board.dowels, settings).map(op => ({
        ...op,
        passes: op.passes.map(p => ({ ...p, pts: p.pts.map(q => turn(q)) })),
      }))
    );
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
          const c = turn(partToBoard(p, [p.size[0] / 2, p.size[1] / 2, 0]));
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
  return { stockTop, operations, warnings, ...(holding && { holding: [...holding.values()] }) };
}

/** Bits in the order a board program uses them. */
export const boardBits = (cam: PartCam) =>
  cam.operations.reduce<number[]>((bits, op) => (bits.at(-1) === op.tool.diameter ? bits : [...bits, op.tool.diameter]), []);

/**
 * Board queue that reuses the bit in the collet: start with boards whose first bit is `startBit` (or the smallest),
 * and after each board pick one that starts with the bit the last one ended with -- preferring one that also ends
 * with it, so the bit stays in for the boards after it too. Stable otherwise.
 */
export function orderBoardQueue<T extends { bits: number[] }>(boards: T[], startBit?: number): T[] {
  const left = [...boards];
  const out: T[] = [];
  let bit = startBit ?? Math.min(...boards.flatMap(b => b.bits.slice(0, 1)));
  while (left.length) {
    const keeps = left.findIndex(b => b.bits[0] === bit && b.bits.at(-1) === bit);
    const i =
      keeps >= 0
        ? keeps
        : Math.max(
            0,
            left.findIndex(b => b.bits[0] === bit)
          );
    const [next] = left.splice(i, 1);
    out.push(next);
    bit = next.bits.at(-1) ?? bit;
  }
  return out;
}

/**
 * One program per bit, in cutting order. FluidNC can't jog, probe or set Z while a program is paused at M0, so a
 * bit swap with a new Z zero can't happen inside one program: the board stays put, the user swaps the bit, zeroes Z
 * with the normal flow and starts the next program.
 */
export function splitByBit(cam: PartCam): PartCam[] {
  const out: PartCam[] = [];
  for (const op of cam.operations) {
    const last = out.at(-1);
    if (last && last.operations[0].tool.diameter === op.tool.diameter) last.operations.push(op);
    else out.push({ stockTop: cam.stockTop, operations: [op], warnings: out.length ? [] : cam.warnings });
  }
  return out;
}
