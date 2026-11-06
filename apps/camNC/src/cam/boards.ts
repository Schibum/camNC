import type { FlipRegistration, HoleChoice, HoldDown } from '@wbcnc/cam';
import { edgeDir, holdBox, kDefaultStickout, pathClearance, type HoldKind, type HoldPoint } from '@wbcnc/cam/holdPoints';
import { nestRects, placedSize, type NestResult, type Placement, type Rect } from '@wbcnc/cam/nest';
import {
  fewerHolds,
  fixturesAround,
  partDist,
  settle,
  fitsMachine,
  moreHolds,
  simplifyLoops,
  snapScrew,
  suggestHolds,
  suggestHoldsGrowing,
  workBox,
  type BoardSide,
  type Fixture,
  type SettleBoard,
  type SettlePart,
  type Spots,
} from '@wbcnc/cam/settle';
import { autoNest, type NestObjective, type SheetPacker } from './autoNest';
import type { BoardRequest, CamPartInfo } from './camTypes';
import { kDefaultHardware, type HoldHardware } from './holdHardware';
import type { MaterialKey } from './planSettings';

export interface StockBoardV1 {
  id: string;
  thickness: number;
  w: number;
  h: number;
  /** How many of these boards there are; undefined = as many as needed. */
  quantity?: number;
}

export interface BoardV1 {
  id: string;
  /** A, B, C … in the order the boards were made, or a name the user gave it. */
  name: string;
  thickness: number;
  material: MaterialKey;
  /** Fit the board to its parts, or a fixed size (e.g. from the stock list). */
  size: { fit: true } | { fit: false; w: number; h: number };
  /** What keeps the parts in place once their outlines are cut. */
  retention: Retention;
  /** With tabs: stop at each tab at the machine, a guided program removes them. */
  guidedTabs?: boolean;
  /** Tape under the board. */
  taped?: boolean;
  /** Where the board is clamped or screwed, as the user placed them. None: tape, or held down by hand. */
  fixtures?: Fixture[];
  tabs: { width: number; height: number; minCount: number };
  /** Free border inside the board edge, mm; default bit + 2, with tabs bit + 3.5 (`defaultMargin`). */
  margin?: number;
  /** Space between parts, mm; default bit + 4, with tabs 2 × bit + 3.5 (`boardGap`). */
  gap?: number;
  /** Stock thickness measured at the machine; default the parts' thickness + `kStockAllowance`. */
  measuredThickness?: number;
  /** Bodies on this board, as instance ids (see `instancesOf`). */
  items: string[];
  /**
   * The parts' undersides, after turning the board over: how it lines up then. Default: re-align with the camera
   * when a part has features underneath.
   */
  flip?: FlipRegistration | 'off';
  /** Pin diameter for a flip on dowel pins, mm (default 6). */
  dowelDiameter?: number;
  /** Per body (instance id): tabs the user dragged into place, part frame (as laid flat), mm. Unset: picked. */
  tabsAt?: Record<string, { x: number; y: number }[]>;
  /** Bodies the user put on this board by hand: auto-fill leaves them here. */
  pinned?: string[];
  /**
   * Where the parts are, and the board's size when fitted: stored, so nothing moves unless asked to. Nesting only fills in
   * bodies that have no spot here.
   */
  layout?: BoardLayout;
  /**
   * Where the board lies on the bed, set at the machine (dragging the outline): the machine X/Y of its XY zero (lower
   * left corner), side A and, turned over, side B. Loading one of its programs puts the program there again.
   */
  bed?: { a?: BedSpot; b?: BedSpot };
  /**
   * What of the board is cut, recorded at the machine: when cutting began and which of its programs ran (queue entry
   * keys). Once cut, its layout and holds are locked (the wood is cut that way) until "Start over".
   */
  cut?: BoardCut;
}

export type Retention = 'tabs' | 'skin' | 'none';

/** The board's parts as laid out: bodies (instance id) at their spots, on a board of this size. */
export interface BoardLayout {
  w: number;
  h: number;
  at: Record<string, PartPosition>;
}

/** A spot on the bed, machine coordinates, mm, and the angle the board lies at there (degrees, counterclockwise). */
export interface BedSpot {
  x: number;
  y: number;
  deg?: number;
}

/** What of a board is cut. */
export interface BoardCut {
  /** When its first program was done, ms since the epoch. */
  at: number;
  /** The programs done (`QueueEntry.doneId`): planned again into another program, that one isn't cut. */
  keys: string[];
  /** Every program of the board ran. */
  all?: boolean;
}

/** The board has a program cut: its layout and holds stay as they are. */
export const isCut = (board: Pick<BoardV1, 'cut'>) => !!board.cut?.keys.length;

/** "Cut" or "Partly cut", for a cut board. */
export const cutLabel = (board: Pick<BoardV1, 'cut'>) => (board.cut?.all ? 'Cut' : 'Partly cut');

/**
 * The fields a cut board keeps: everything that decides where its parts are and what holds it. What it may still
 * change: its name, its spot on the bed, the measured thickness, what's cut.
 */
const kAfterCut = new Set<string>(['name', 'bed', 'cut', 'measuredThickness']);

/** A change to a cut board that would change how it's cut (see `isCut`). */
export function changesCutBoard(before: BoardV1, after: BoardV1 | undefined) {
  if (!isCut(before)) return false;
  if (!after) return true;
  const strip = (b: BoardV1) =>
    JSON.stringify(
      Object.entries(b)
        .filter(([k, v]) => v !== undefined && !kAfterCut.has(k))
        .sort(([a], [b]) => a.localeCompare(b))
    );
  return strip(before) !== strip(after);
}

/** Where a body sits on its board: lower left corner of its (possibly turned) outline, board frame, mm. */
export interface PartPosition {
  x: number;
  y: number;
  /** Turned 90° counterclockwise. */
  rotated: boolean;
}

/** One body to cut: the k-th of a group of identical bodies. */
export interface PartInstance {
  /** Has features on its underside: needs the board turned over for a second side. */
  needsFlip?: boolean;
  id: string;
  partId: string;
  name: string;
  size: [number, number, number];
  thickness: number;
  /** Its outlines and holes as laid flat, simplified: what fixtures keep clear of. Unknown: its rectangle. */
  outline?: Pick<SettlePart, 'outer' | 'holes'>;
}

/** Simplified once per part: fixtures are checked against it while they're dragged. */
const kOutlines = new WeakMap<CamPartInfo, Pick<SettlePart, 'outer' | 'holes'>>();
function outlineOf(part: CamPartInfo) {
  let known = kOutlines.get(part);
  if (!known) kOutlines.set(part, (known = { outer: simplifyLoops(part.shape.outlines), holes: simplifyLoops(part.shape.holes) }));
  return known;
}

/** What the cutting program is told: how the parts are held, from what's chosen for the board. */
export function holdDownOf(board: Pick<BoardV1, 'retention' | 'guidedTabs' | 'taped'>): HoldDown {
  if (board.retention === 'skin') return board.taped ? 'fixture-tape' : 'skin';
  if (board.retention === 'none') return 'none';
  // Anything else gets tabs, which block the job if they can't hold: never parts cut loose by accident.
  return board.guidedTabs ? 'tabs-guided' : 'tabs';
}

/**
 * The stick-out to assume until it's measured: the deepest cut (through the stock, 0.3 mm into the spoilboard) plus
 * 10 mm, so the collet nut clears the board; at least the old fixed default.
 */
export const defaultStickout = (board: Pick<BoardV1, 'thickness' | 'measuredThickness'>) =>
  Math.max(kDefaultStickout, Math.ceil((board.measuredThickness ?? board.thickness + kStockAllowance) + 0.3 + 10));

/** The lowest the collet nut gets on this board, mm above the stock's top: the stick-out less the deepest cut. */
export const nutAboveOf = (board: Pick<BoardV1, 'thickness' | 'measuredThickness'>, stickout?: number, cutBelow = 0.3) =>
  +((stickout ?? defaultStickout(board)) - stockTopOf(board) - cutBelow).toFixed(2);

/** What a new board copies from the one it's split off, and an auto-filled board from the old one of its thickness. */
export const holdSettingsOf = (b: BoardV1): Partial<BoardV1> => ({
  retention: b.retention,
  tabs: b.tabs,
  ...(b.guidedTabs && { guidedTabs: true }),
  ...(b.taped && { taped: true }),
});

export const kRetentionLabels: Record<Retention, string> = {
  tabs: 'Tabs',
  skin: 'Bottom skin',
  none: 'Nothing, I watch them',
};

/** "2 clamps, 1 screw". */
export function fixtureCount(fixtures: Pick<Fixture, 'kind'>[] = []) {
  const clamps = fixtures.filter(f => f.kind === 'clamp').length,
    screws = fixtures.length - clamps;
  return [clamps && `${clamps} clamp${clamps > 1 ? 's' : ''}`, screws && `${screws} screw${screws > 1 ? 's' : ''}`]
    .filter(Boolean)
    .join(', ');
}

/** Narrowest strip of stock, mm, that holds a tab after the cuts on both sides of it (the hold check's). */
const kTabWeb = 3.5;
/**
 * Default border inside the board edge: the outline cut (bit) plus 2 mm stays on the board. With tabs, enough that the
 * strip left outside the cut holds them.
 */
export const defaultMargin = (bit: number, retention?: Retention) => +(bit + (retention === 'tabs' ? kTabWeb : 2)).toFixed(1);
/**
 * Gap between parts: the bit plus 4 mm, so outline cuts never meet. With tabs, room for both cuts and a strip between
 * them that holds the tabs of either part.
 */
export const boardGap = (bit: number, retention?: Retention) => Math.ceil(retention === 'tabs' ? 2 * bit + kTabWeb : bit + 4);

/**
 * Before the bit changes: keep each board's margin and gap as they are, so the nest the user saw stays (a bigger
 * bit would otherwise widen them and push parts off the board).
 */
export function freezeSpacing(boards: BoardV1[], bit: number): BoardV1[] {
  return boards.map(b => ({ ...b, margin: b.margin ?? defaultMargin(bit, b.retention), gap: b.gap ?? boardGap(bit, b.retention) }));
}

/**
 * Why a board's gap is too tight for this bit: the cut around each part needs the bit's width (+1 mm), or one part's
 * outline cut eats into its neighbour. Blocks the job.
 */
export function spacingProblem(board: BoardV1, nest: { gap: number; margin: number }, bit: number): string | null {
  if (nest.gap < bit + 1) return `Board ${board.name}: the ${nest.gap} mm gap between parts is too narrow for the ⌀${bit} bit.`;
  return null;
}

/**
 * The outline cuts run past the board's edge (the margin is narrower than the bit): the bit only cuts air there, fine
 * unless something holds the board down there. A note, not a blocker (on tab boards the hold check catches parts the
 * thin strip left at the edge can't hold).
 */
export function edgeNote(board: BoardV1, nest: { gap: number; margin: number }, bit: number): string | null {
  if (nest.margin >= bit) return null;
  const past = `Board ${board.name}: the outline cuts run past the board edge (${nest.margin} mm margin, ⌀${bit} bit).`;
  // The hold check blocks the job if the bit would hit a fixture.
  return board.fixtures?.length
    ? `${past} Keep screws and clamps clear of it: the job is blocked if the bit would hit one.`
    : `${past} Fine if nothing is clamped or screwed there.`;
}
/** Boards are bought a little thicker than the parts: cutting starts at thickness + this unless measured. */
export const kStockAllowance = 0.3;
export const stockTopOf = (board: Pick<BoardV1, 'thickness' | 'measuredThickness'>) =>
  board.measuredThickness ?? +(board.thickness + kStockAllowance).toFixed(2);
export const kDefaultTabs = { width: 5, height: 2, minCount: 3 };

const thicknessKey = (t: number) => +t.toFixed(1);

export function instancesOf(parts: CamPartInfo[], milled: (partId: string) => boolean): PartInstance[] {
  return (
    parts
      // 3D parts default to not milled (camQueries); milling one anyway is the user's call.
      .filter(p => milled(p.id))
      .flatMap(p =>
        p.names.map((name, k) => ({
          id: `${p.id}#${k}`,
          partId: p.id,
          name,
          size: p.size,
          thickness: p.thickness,
          needsFlip: p.summary.needsFlip,
          outline: outlineOf(p),
        }))
      )
  );
}

const letter = (i: number) => (i < 26 ? String.fromCharCode(65 + i) : `B${i + 1}`);

/** What a board is called: "Board A" until it's given a name of its own. */
export const boardLabel = (board: Pick<BoardV1, 'name'>) => (/^([A-Z]|B\d+)$/.test(board.name) ? `Board ${board.name}` : board.name);

/** Why a board can't have this name: it's in messages at the machine and in the G-code file's name. */
export function boardNameProblem(name: string, boards: Pick<BoardV1, 'id' | 'name'>[], id: string): string | null {
  if (!name) return 'A board needs a name.';
  if (name.length > 30) return 'That name is too long: 30 characters at most.';
  if (/[/\\:*?"<>|]/.test(name)) return 'A board’s name goes in the G-code file’s name, so it can’t have any of / \\ : * ? " < > |.';
  if (boards.some(b => b.id !== id && b.name === name)) return `There already is a board called ${name}.`;
  return null;
}

export function newBoard(
  boards: BoardV1[],
  thickness: number,
  material: MaterialKey,
  items: string[] = [],
  id: string = crypto.randomUUID()
): BoardV1 {
  const used = new Set(boards.map(b => b.name));
  let i = 0;
  while (used.has(letter(i))) i++;
  return {
    id,
    name: letter(i),
    thickness: thicknessKey(thickness),
    material,
    size: { fit: true },
    retention: 'tabs',
    tabs: kDefaultTabs,
    items,
  };
}

/**
 * Keep the user's boards in sync with the parts to mill: drop bodies that are gone (or not milled any more), put new
 * ones on the first board of their thickness (making one if needed). Empty boards stay until deleted (the user may
 * be about to drag parts onto them).
 */
/** The spots of these bodies only. */
const onlyFor = (at: Record<string, PartPosition>, ids: string[]) =>
  Object.fromEntries(Object.entries(at).filter(([id]) => ids.includes(id)));

/** A new board's material: thin boards (back panels, drawer bottoms: 6 mm or less) are usually plywood or HDF. */
export const defaultMaterial = (thickness: number, material: MaterialKey): MaterialKey =>
  thickness <= 6 && material !== 'mdf' ? 'plywood' : material;

export function reconcileBoards(boards: BoardV1[] | undefined, instances: PartInstance[], material: MaterialKey): BoardV1[] {
  const byId = new Map(instances.map(i => [i.id, i]));
  let out = (boards ?? []).map(b => {
    const items = b.items.filter(id => byId.get(id)?.thickness !== undefined && thicknessKey(byId.get(id)!.thickness) === b.thickness);
    // Saved before `retention`: tabs, which say so if they can't hold.
    const held = { ...b, retention: b.retention ?? ('tabs' as const), items };
    const kept = b.pinned ? { ...held, pinned: b.pinned.filter(id => items.includes(id)) } : held;
    // Saved before layouts were stored: its parts get new spots, so what was cut on it no longer applies.
    if (!b.layout) {
      const fresh = { ...kept };
      delete fresh.cut;
      return fresh;
    }
    return { ...kept, layout: { ...b.layout, at: onlyFor(b.layout.at, items) } };
  });
  const placed = new Set(out.flatMap(b => b.items));
  for (const inst of instances) {
    if (placed.has(inst.id)) continue;
    const t = thicknessKey(inst.thickness);
    const board = out.find(b => b.thickness === t);
    if (board) board.items.push(inst.id);
    // The same id every time for the same thickness: until the boards are saved (the Boards step), every change to the
    // job makes them afresh, and a new id would make them new boards (planned again, the one shown gone).
    else out = [...out, newBoard(out, t, defaultMaterial(t, material), [inst.id], `auto-${t}mm`)];
  }
  return out;
}

export interface BoardNest extends NestResult {
  gap: number;
  margin: number;
  /** The job's bit, mm: what the fixtures' clearances go by. */
  bit: number;
  /** Where the board is screwed or clamped: `board.fixtures`, in the same order. */
  holds: HoldPoint[];
  /** The bit's stick-out below the collet nut, mm, and how low the nut gets over the board on the deepest cut. */
  stickout: number;
  nutAbove: number;
}

export interface NestOptions {
  /** Only where the parts go, no hold points. */
  holds?: boolean;
  stickout?: number;
  hardware?: HoldHardware;
  /**
   * The machine's work area (X × Y, mm): a board fitted to its parts stays within it and lies with its long side along
   * the machine's long axis. Parts that don't fit then are `unplaced` (see `keepWithinMachine`).
   */
  machine?: { w: number; h: number };
}

const kMaxElongation = 2.5;

/**
 * Fit a board to its parts, but not as a strip: the smallest area can be one long row (2.4 m for the kinderregal
 * sides and shelves). Beyond 2.5:1, nest on a width near the square root of the parts' area instead.
 */
function fitCompact(items: { id: string; w: number; h: number }[], gap: number, margin: number, fixed: Rect[]): NestResult {
  // Bodies placed by hand are obstacles, and the board grows to take them in.
  const grow = (b: { w: number; h: number }) => ({
    w: Math.max(b.w, ...fixed.map(r => r.x + r.w + margin)),
    h: Math.max(b.h, ...fixed.map(r => r.y + r.h + margin)),
  });
  const first = nestRects(items, { gap, margin, keepOuts: fixed });
  const fit = { ...first, board: grow(first.board) };
  const { w, h } = fit.board;
  if (!items.length || Math.max(w, h) / Math.min(w, h) <= kMaxElongation) return fit;
  const area = items.reduce((a, i) => a + (i.w + gap) * (i.h + gap), 0);
  const width = Math.max(...items.map(i => i.w)) + 2 * margin;
  for (const W of [Math.sqrt(area) * 1.2, Math.sqrt(area) * 1.5, Math.sqrt(area) * 2].map(x =>
    Math.max(width, Math.ceil(x + 2 * margin))
  )) {
    const n = nestRects(items, { gap, margin, keepOuts: fixed, board: { w: W, h: 1e6 } });
    if (n.unplaced.length) continue;
    const used = n.placements.map(p => {
      const i = items.find(x => x.id === p.id)!;
      return { x: p.x + (p.rotated ? i.h : i.w), y: p.y + (p.rotated ? i.w : i.h) };
    });
    const board = grow({ w: Math.max(...used.map(u => u.x)) + margin, h: Math.max(...used.map(u => u.y)) + margin });
    const partArea = items.reduce((a, i) => a + i.w * i.h, 0);
    if (Math.max(board.w, board.h) / Math.min(board.w, board.h) <= kMaxElongation)
      return { ...n, board, yield: partArea / (board.w * board.h) };
  }
  return fit;
}

/** The items turned 90°: nested so, each is placed the other way round. */
const turnedItems = (items: { id: string; w: number; h: number }[]) => items.map(i => ({ id: i.id, w: i.h, h: i.w }));
const turnedBack = (n: NestResult): NestResult => ({ ...n, placements: n.placements.map(p => ({ ...p, rotated: !p.rotated })) });

/**
 * On a board of this size: parts keep their grain direction where they fit, the ones that don't may turn 90° into the
 * room left.
 */
function nestOnSize(
  items: { id: string; w: number; h: number }[],
  size: { w: number; h: number },
  gap: number,
  margin: number,
  keepOuts: Rect[]
) {
  const n = nestRects(items, { gap, margin, keepOuts, board: size });
  if (!n.unplaced.length) return n;
  const placed = n.placements.map(p => {
    const i = items.find(x => x.id === p.id)!;
    return { x: p.x, y: p.y, ...placedSize(i, p.rotated) };
  });
  const rest = items.filter(i => n.unplaced.includes(i.id)).map(i => ({ ...i, canRotate: true }));
  const turned = nestRects(rest, { gap, margin, keepOuts: [...keepOuts, ...placed], board: size });
  if (!turned.placements.length) return n;
  const order = new Map(items.map((it, i) => [it.id, i]));
  return {
    ...n,
    placements: [...n.placements, ...turned.placements].sort((a, b) => order.get(a.id)! - order.get(b.id)!),
    unplaced: turned.unplaced,
  };
}

/** The extent of the placed parts, plus the margin: what a fitted board is cut to. */
function usedSize(n: NestResult, items: { id: string; w: number; h: number }[], margin: number, fixed: Rect[]) {
  const rects = [
    ...n.placements.map(p => {
      const i = items.find(x => x.id === p.id)!;
      return { x: p.x, y: p.y, ...placedSize(i, p.rotated) };
    }),
    ...fixed,
  ];
  return {
    w: Math.max(2 * margin, ...rects.map(r => r.x + r.w + margin)),
    h: Math.max(2 * margin, ...rects.map(r => r.y + r.h + margin)),
  };
}

/** Up to whole mm, but never rounded past the machine it fits on. */
function wholeMm(b: { w: number; h: number }, machine?: { w: number; h: number }) {
  const up = { w: ceilMm(b.w), h: ceilMm(b.h) };
  if (!machine || fitsMachine(machine, up.w, up.h) || !fitsMachine(machine, b.w, b.h)) return up;
  const [mw, mh] = fitsAsIs(machine, b) ? [machine.w, machine.h] : [machine.h, machine.w];
  return { w: Math.min(up.w, Math.max(b.w, Math.floor(mw))), h: Math.min(up.h, Math.max(b.h, Math.floor(mh))) };
}

/** The machine's long axis is X. */
const wideMachine = (m: { w: number; h: number }) => m.w >= m.h;
const fitsAsIs = (m: { w: number; h: number }, b: { w: number; h: number }) => b.w <= m.w + EPS && b.h <= m.h + EPS;

/**
 * Fit a board to its parts on this machine: as `fitCompact`, lying with its long side along the machine's long axis (the
 * whole layout turned when that's the way it fits). Too big either way: nested on the work area, the board cut to what's
 * on it, and the parts left over `unplaced`. Bodies placed by hand (`fixed`) stay, so the layout isn't turned then.
 */
function fitOnMachine(
  items: { id: string; w: number; h: number }[],
  gap: number,
  margin: number,
  fixed: Rect[],
  machine: { w: number; h: number }
): NestResult {
  const area = (n: NestResult) =>
    n.placements.reduce((a, p) => a + items.find(i => i.id === p.id)!.w * items.find(i => i.id === p.id)!.h, 0);
  const straight = fitCompact(items, gap, margin, fixed);
  const turned = fixed.length || !items.length ? undefined : turnedBack(fitCompact(turnedItems(items), gap, margin, fixed));
  const lying = (n: NestResult) => n.board.w >= n.board.h === wideMachine(machine) || n.board.w === n.board.h;
  const fits = [straight, ...(turned ? [turned] : [])].filter(n => fitsAsIs(machine, n.board));
  if (fits.length) return fits.find(lying) ?? fits[0];
  // Too big for the machine: as much as fits on the work area, then cut down to it.
  const on = (its: typeof items) => nestOnSize(its, machine, gap, margin, fixed);
  const options = [on(items), ...(fixed.length ? [] : [turnedBack(on(turnedItems(items)))])];
  const best = options.reduce((a, b) => (area(b) > area(a) ? b : a));
  const board = usedSize(best, items, margin, fixed);
  const total = items.reduce((a, i) => a + i.w * i.h, 0);
  return { ...best, board, yield: total && area(best) / (board.w * board.h) };
}

const EPS = 1e-6;
/** Up to whole mm, ignoring float noise (571.0000001 stays 571). */
const ceilMm = (v: number) => Math.ceil(v - 1e-6);

/**
 * A board's size for people: "571 × 739", or "–" for a fitted board with nothing on it yet (its size is only the
 * edge margins).
 */
export function boardSizeLabel(board: Pick<BoardV1, 'size'>, nest: Pick<BoardNest, 'board' | 'placements'>): string {
  if (board.size.fit && !nest.placements.length) return '–';
  return `${+nest.board.w.toFixed(1)} × ${+nest.board.h.toFixed(1)}`;
}
/** At least `gap` apart. */
const apart = (a: Rect, b: Rect, gap: number) =>
  a.x + a.w + gap <= b.x + EPS || b.x + b.w + gap <= a.x + EPS || a.y + a.h + gap <= b.y + EPS || b.y + b.h + gap <= a.y + EPS;
/** Inside the board's edge margin (a fitted board grows: only its lower and left edge). */
const insideMargin = (r: Rect, margin: number, board?: { w: number; h: number }) =>
  r.x >= margin - EPS && r.y >= margin - EPS && (!board || (r.x + r.w <= board.w - margin + EPS && r.y + r.h <= board.h - margin + EPS));

/** The fixture as a hold point on a board of this size. */
export function holdPointOf(f: Fixture, board: { w: number; h: number }, hw: HoldHardware, nutAbove: number): HoldPoint {
  if (f.kind === 'screw') return { x: f.x, y: f.y, kind: 'screw', d: hw.screw.d, height: hw.screw.height, nutAbove };
  const { d, w, height } = hw.clamp;
  const [at, dir] =
    f.side === 'left'
      ? [
          { x: d / 2, y: f.at },
          { x: 1, y: 0 },
        ]
      : f.side === 'right'
        ? [
            { x: board.w - d / 2, y: f.at },
            { x: -1, y: 0 },
          ]
        : f.side === 'bottom'
          ? [
              { x: f.at, y: d / 2 },
              { x: 0, y: 1 },
            ]
          : [
              { x: f.at, y: board.h - d / 2 },
              { x: 0, y: -1 },
            ];
  return { ...at, kind: 'clamp', d, w, height, dir, nutAbove };
}

/** The hold point as a fixture: the edge it grips, or where it sits. */
export function fixtureOf(h: Pick<HoldPoint, 'kind' | 'x' | 'y' | 'dir'>): Fixture {
  const round = (v: number) => Math.round(v * 10) / 10;
  if (h.kind === 'screw') return { kind: 'screw', x: round(h.x), y: round(h.y) };
  const side: BoardSide = h.dir?.x === 1 ? 'left' : h.dir?.x === -1 ? 'right' : h.dir?.y === 1 ? 'bottom' : 'top';
  return { kind: 'clamp', side, at: round(side === 'left' || side === 'right' ? h.y : h.x) };
}

/**
 * The board as laid out: bodies at their stored spots (one that no longer works, off the board or on another part, is
 * ignored), then nesting only for bodies without a spot, around the others and the fixtures. A board with no layout yet
 * is simply nested tight: fixtures come after the parts, and `settleBoard` makes room for them.
 */
export function nestBoard(board: BoardV1, instances: PartInstance[], bit: number, opts: NestOptions = {}): BoardNest {
  const byId = new Map(instances.map(i => [i.id, i]));
  const ids = board.items.filter(id => byId.has(id));
  const gap = board.gap ?? boardGap(bit, board.retention);
  const margin = board.margin ?? defaultMargin(bit, board.retention);
  const hw = opts.hardware ?? kDefaultHardware;
  const nutAbove = nutAboveOf(board, opts.stickout);
  const size = board.size.fit ? undefined : { w: board.size.w, h: board.size.h };
  const machine = board.size.fit ? opts.machine : undefined;
  // A fitted layout bigger than the machine (stored before the machine was known): nested again, within it, around the
  // parts placed by hand that are on the machine.
  const oversize = !!board.layout && !!machine && !isCut(board) && !fitsMachine(machine, board.layout.w, board.layout.h);
  const stored = oversize ? { at: onlyFor(board.layout!.at, board.pinned ?? []) } : board.layout;
  // The size to place on: fixed, or as the layout left it. A fitted board may still grow.
  const on = size ?? (stored && !oversize ? { w: board.layout!.w, h: board.layout!.h } : undefined);
  const holdsOn = (b: { w: number; h: number }) => (board.fixtures ?? []).map(f => holdPointOf(f, b, hw, nutAbove));

  const fixed: Placement[] = [];
  const fixedRects: Rect[] = [];
  for (const id of ids) {
    const pos = stored?.at[id];
    if (!pos) continue;
    const r = placedRect(pos, byId.get(id)!);
    // A cut board's parts are where they were cut, whatever the spacing says now.
    if (!isCut(board) && (!insideMargin(r, margin, on) || !fixedRects.every(o => apart(r, o, gap)))) continue;
    if (oversize && !insideMargin(r, margin, machine)) continue;
    fixed.push({ id, x: pos.x, y: pos.y, rotated: pos.rotated });
    fixedRects.push(r);
  }
  const items = ids.filter(id => !fixed.some(p => p.id === id)).map(id => ({ id, w: byId.get(id)!.size[0], h: byId.get(id)!.size[1] }));
  // Clear of what's there: the fixtures' footprints with room for the cut, less what the nest keeps from a part anyway.
  const keepOutOf = (h: HoldPoint): Rect => {
    const b = holdBox(h);
    const keep = pathClearance(h, bit / 2) - bit / 2 - (gap - bit);
    const [kx, ky] = [Math.max(keep, -b.w / 2), Math.max(keep, -b.h / 2)];
    return { x: b.x - kx, y: b.y - ky, w: b.w + 2 * kx, h: b.h + 2 * ky };
  };
  const around = (b: { w: number; h: number }) => [...fixedRects, ...holdsOn(b).map(keepOutOf)];
  let n: NestResult;
  if (size) {
    n = nestOnSize(items, size, gap, margin, around(size));
  } else {
    const roomOn = on && items.length ? nestRects(items, { gap, margin, keepOuts: around(on), board: on }) : undefined;
    // Growing up and to the right: fixtures on the other edges and screws stay where they are, so parts keep off them.
    const staying = (board.fixtures ?? [])
      .filter(f => f.kind === 'screw' || f.side === 'left' || f.side === 'bottom')
      .map(f => keepOutOf(holdPointOf(f, { w: 0, h: 0 }, hw, nutAbove)));
    const keep = [...fixedRects, ...staying];
    n =
      roomOn && !roomOn.unplaced.length
        ? roomOn
        : machine
          ? fitOnMachine(items, gap, margin, keep, machine)
          : fitCompact(items, gap, margin, keep);
  }

  const order = new Map(ids.map((id, i) => [id, i]));
  const placements = [...fixed, ...n.placements].sort((a, b) => order.get(a.id)! - order.get(b.id)!);
  const area = placements.reduce((a, p) => a + byId.get(p.id)!.size[0] * byId.get(p.id)!.size[1], 0);
  // A fitted board is cut from a sheet: whole mm, rounded up (570.4 × 738.9 -> 571 × 739), though not past the
  // machine. It never shrinks on its own.
  const fitted = {
    w: Math.max(n.board.w, placements.length && on ? on.w : 0),
    h: Math.max(n.board.h, placements.length && on ? on.h : 0),
  };
  const out = size ?? wholeMm(fitted, machine);
  return {
    ...n,
    board: out,
    placements,
    yield: out.w * out.h > 0 ? area / (out.w * out.h) : 0,
    gap,
    margin,
    bit,
    holds: opts.holds === false ? [] : holdsOn(out),
    stickout: opts.stickout ?? defaultStickout(board),
    nutAbove,
  };
}

/**
 * No fitted board bigger than the machine: parts that don't fit on theirs within the work area move to another fitted
 * board of their thickness with room for them, else onto a new board (with the same hold settings), made as often as
 * needed. Cut boards, fixed-size boards and parts placed by hand stay; a part too big for the machine on its own stays
 * where it is (it shows as not fitting).
 */
export function keepWithinMachine(boards: BoardV1[], instances: PartInstance[], bit: number, opts: NestOptions): BoardV1[] {
  const machine = opts.machine;
  if (!machine) return boards;
  const nest = (b: BoardV1) => nestBoard(b, instances, bit, { ...opts, holds: false });
  const movable = (b: BoardV1) => b.size.fit && !isCut(b);
  let out = [...boards];
  for (let i = 0; i < out.length; i++) {
    const b = out[i];
    if (!movable(b)) continue;
    const over = nest(b).unplaced.filter(id => !b.pinned?.includes(id));
    // Alone on a board it still doesn't fit: moving it wouldn't help.
    const spill = over.filter(id => !nest({ ...b, items: [id], pinned: [], layout: undefined, fixtures: [] }).unplaced.length);
    if (!spill.length) continue;
    out[i] = { ...b, items: b.items.filter(id => !spill.includes(id)) };
    let rest = spill;
    for (let j = 0; j < out.length && rest.length; j++) {
      const o = out[j];
      if (j === i || !movable(o) || o.thickness !== b.thickness) continue;
      const before = nest(o);
      if (before.unplaced.length) continue;
      const placed = new Set(nest({ ...o, items: [...o.items, ...rest] }).placements.map(p => p.id));
      // Only what fits with everything already on it.
      const take = rest.filter(id => placed.has(id));
      if (!take.length || !o.items.every(id => placed.has(id))) continue;
      out[j] = { ...o, items: [...o.items, ...take] };
      rest = rest.filter(id => !take.includes(id));
    }
    if (!rest.length) continue;
    // The same id every time for the same overflow (see `reconcileBoards`): this one is nested in turn, and spills on.
    let id = `${b.id}+`;
    while (out.some(o => o.id === id)) id += '+';
    out = [...out.slice(0, i + 1), { ...newBoard(out, b.thickness, b.material, rest, id), ...holdSettingsOf(b) }, ...out.slice(i + 1)];
  }
  return out;
}

/** The board with its nest stored: from then on its parts stay where they are. */
export function withLayout(board: BoardV1, nest: Pick<BoardNest, 'board' | 'placements'>): BoardV1 {
  const rest = { ...board };
  delete rest.layout;
  // A cut board keeps one even with no part left: it's how a board saved before layouts is told apart.
  if (!nest.placements.length && !isCut(board)) return rest;
  const at = Object.fromEntries(nest.placements.map(p => [p.id, { x: p.x, y: p.y, rotated: p.rotated }]));
  return { ...rest, layout: { w: nest.board.w, h: nest.board.h, at } };
}

/** What `settle` works on: the board's parts at these spots, on a board of this size. */
function settleInput(
  board: BoardV1,
  at: Record<string, PartPosition>,
  size: { w: number; h: number },
  instances: PartInstance[],
  bit: number,
  opts: NestOptions
): { input: SettleBoard; spots: Spots } {
  const hw = opts.hardware ?? kDefaultHardware;
  const nutAbove = nutAboveOf(board, opts.stickout);
  const keep = (kind: HoldKind, height: number) => pathClearance({ kind, height, nutAbove }, bit / 2) + bit / 2;
  const parts: SettlePart[] = [];
  const spots: Spots = {};
  for (const inst of instances) {
    const pos = at[inst.id];
    if (!pos) continue;
    const r = placedRect(pos, inst);
    const turn = (loops: [number, number][][]) =>
      pos.rotated ? loops.map(l => l.map(([x, y]): [number, number] => [inst.size[1] - y, x])) : loops;
    const rect: [number, number][] = [
      [0, 0],
      [inst.size[0], 0],
      [inst.size[0], inst.size[1]],
      [0, inst.size[1]],
    ];
    parts.push({ id: inst.id, w: r.w, h: r.h, outer: turn(inst.outline?.outer ?? [rect]), holes: turn(inst.outline?.holes ?? []) });
    spots[inst.id] = { x: pos.x, y: pos.y };
  }
  return {
    spots,
    input: {
      w: size.w,
      h: size.h,
      gap: board.gap ?? boardGap(bit, board.retention),
      margin: board.margin ?? defaultMargin(bit, board.retention),
      parts,
      sizes: { clampReach: hw.clamp.d, clampWidth: hw.clamp.w, screwD: hw.screw.d },
      keep: { clamp: keep('clamp', hw.clamp.height), screw: keep('screw', hw.screw.height) },
    },
  };
}

/** The board as it stands, for `settle` and its helpers. */
export function settleInputOf(
  board: BoardV1,
  nest: Pick<BoardNest, 'board' | 'placements'>,
  instances: PartInstance[],
  bit: number,
  opts: NestOptions = {}
) {
  return settleInput(board, withLayout(board, nest).layout?.at ?? {}, nest.board, instances, bit, opts);
}

const withSpots = (board: BoardV1, at: Record<string, PartPosition>, spots: Spots, w: number, h: number): BoardV1 => ({
  ...board,
  layout: {
    w,
    h,
    at: Object.fromEntries(Object.entries(at).map(([id, p]) => [id, { ...p, ...(spots[id] ?? {}) }])),
  },
});

export interface SettleOptions extends NestOptions {
  /** How hard to look: less while a fixture is being dragged. */
  budget?: number;
}

/**
 * The board with these fixtures, and only the parts in their way moved (see `settle`). A fitted board may grow. Null: no
 * room for them on this size.
 */
export function settleBoard(
  board: BoardV1,
  instances: PartInstance[],
  bit: number,
  fixtures: Fixture[],
  opts: SettleOptions = {}
): BoardV1 | null {
  const nest = nestBoard(board, instances, bit, { ...opts, holds: false });
  const at = withLayout(board, nest).layout?.at ?? {};
  const { input, spots } = settleInput(board, at, nest.board, instances, bit, opts);
  const r = settle(input, spots, fixtures, board.size.fit, opts.budget);
  return r && { ...withSpots(board, at, r.spots, r.w, r.h), fixtures };
}

/**
 * Laid out again: its bodies stay on it, none pinned any more, nested tight and then moved only as far as the fixtures
 * need. If they leave no such way, nested around them.
 */
export function relayoutBoard(board: BoardV1, instances: PartInstance[], bit: number, opts: NestOptions = {}): BoardV1 {
  const fresh = { ...board };
  delete fresh.pinned;
  delete fresh.layout;
  const bare = { ...fresh };
  delete bare.fixtures;
  const tight = withLayout(bare, nestBoard(bare, instances, bit, { ...opts, holds: false }));
  if (!board.fixtures?.length || !tight.layout) return tight;
  const hw = opts.hardware ?? kDefaultHardware;
  // As small as it gets with the fixtures still on it.
  const need = fixturesNeed(board.fixtures, hw);
  const sized = board.size.fit
    ? { ...tight, layout: { ...tight.layout, w: Math.max(tight.layout.w, need.w), h: Math.max(tight.layout.h, need.h) } }
    : tight;
  const fixtures = board.size.fit ? board.fixtures : fixturesOn(board.fixtures, sized.layout!, hw);
  const settled = settleBoard(sized, instances, bit, fixtures, { ...opts, budget: 600 });
  return settled ?? withLayout({ ...fresh, fixtures }, nestBoard({ ...fresh, fixtures }, instances, bit, opts));
}

/** The fixtures on a board of this size: clamps slid back along their edge, screws off it gone. */
function fixturesOn(fixtures: Fixture[] | undefined, size: { w: number; h: number }, hw: HoldHardware): Fixture[] {
  return (fixtures ?? []).flatMap((f): Fixture[] => {
    if (f.kind === 'screw') {
      const r = hw.screw.d / 2;
      return f.x >= r && f.y >= r && f.x <= size.w - r && f.y <= size.h - r ? [f] : [];
    }
    const len = f.side === 'left' || f.side === 'right' ? size.h : size.w;
    return [{ ...f, at: Math.max(hw.clamp.w / 2, Math.min(len - hw.clamp.w / 2, f.at)) }];
  });
}

/** The size a fitted board can't get below without leaving a fixture off it. */
function fixturesNeed(fixtures: Fixture[] | undefined, hw: HoldHardware) {
  let [w, h] = [0, 0];
  for (const f of fixtures ?? []) {
    if (f.kind === 'screw') [w, h] = [Math.max(w, f.x + hw.screw.d / 2), Math.max(h, f.y + hw.screw.d / 2)];
    else if (f.side === 'left' || f.side === 'right') h = Math.max(h, f.at + hw.clamp.w / 2);
    else w = Math.max(w, f.at + hw.clamp.w / 2);
  }
  return { w: ceilMm(w), h: ceilMm(h) };
}

const spacingOf = (b: BoardV1) => JSON.stringify([b.size, b.margin, b.gap, b.retention]);

/**
 * A change to the board's settings, applied to its layout: a new size, margin or gap moves only the parts it has to. Back
 * to "Fit to parts": laid out again, which is how it gets smaller. No way to keep the layout: nested afresh.
 */
export function respaceBoard(prev: BoardV1, next: BoardV1, instances: PartInstance[], bit: number, opts: NestOptions = {}): BoardV1 {
  if (spacingOf(prev) === spacingOf(next) || !prev.layout) return next;
  if (next.size.fit && !prev.size.fit) return relayoutBoard({ ...next, pinned: prev.pinned }, instances, bit, opts);
  const size = next.size.fit ? { w: prev.layout.w, h: prev.layout.h } : { w: next.size.w, h: next.size.h };
  const onIt = { ...next, fixtures: fixturesOn(next.fixtures, size, opts.hardware ?? kDefaultHardware) };
  const { input, spots } = settleInput(onIt, prev.layout.at, size, instances, bit, opts);
  const r = settle(input, spots, onIt.fixtures, next.size.fit, 600);
  if (r) return withSpots(onIt, prev.layout.at, r.spots, r.w, r.h);
  delete (onIt as Partial<BoardV1>).layout;
  return onIt;
}

/**
 * Suggested clamps for the board, on top of what's on it, with the parts nudged aside where needed. A board fitted to its
 * parts gets a border when no edge has room (see `suggestHoldsGrowing`); a fixed one stays its size.
 */
export function suggestFixtures(
  board: BoardV1,
  instances: PartInstance[],
  bit: number,
  opts: NestOptions & { machine?: { w: number; h: number } } = {}
): BoardV1 {
  const nest = nestBoard(board, instances, bit, { ...opts, holds: false });
  const at = withLayout(board, nest).layout?.at ?? {};
  const { input, spots } = settleInput(board, at, nest.board, instances, bit, opts);
  const existing = board.fixtures ?? [];
  const r = board.size.fit
    ? suggestHoldsGrowing(input, spots, existing, opts.machine)
    : { ...suggestHolds(input, spots, existing), ...nest.board };
  return { ...withSpots(board, at, r.spots, r.w, r.h), fixtures: r.fixtures };
}

/**
 * Exactly one clamp more or fewer than the board has, as a nudge from what Suggest holds gave: no part or other hold moves
 * and the board doesn't grow. No room for another, or none can go and leave the work surrounded: the board as it is.
 */
export function nudgeFixtures(board: BoardV1, instances: PartInstance[], bit: number, more: boolean, opts: NestOptions = {}): BoardV1 {
  const nest = nestBoard(board, instances, bit, { ...opts, holds: false });
  const at = withLayout(board, nest).layout?.at ?? {};
  const { input, spots } = settleInput(board, at, nest.board, instances, bit, opts);
  const existing = board.fixtures ?? [];
  const fixtures = (more ? moreHolds : fewerHolds)(input, spots, existing);
  return { ...withSpots(board, at, spots, nest.board.w, nest.board.h), fixtures };
}

/** A fixture at a point: a clamp grips the nearest edge there, a new screw lands on the most forgiving spot nearby. */
export function fixtureAt(
  kind: HoldKind,
  p: { x: number; y: number },
  board: BoardV1,
  nest: Pick<BoardNest, 'board' | 'placements'>,
  instances: PartInstance[],
  bit: number,
  opts: NestOptions & { exact?: boolean } = {}
): Fixture {
  const { w, h } = nest.board;
  if (kind === 'screw') {
    if (opts.exact) return { kind, x: +p.x.toFixed(1), y: +p.y.toFixed(1) };
    const { input, spots } = settleInputOf(board, nest, instances, bit, opts);
    return { kind, ...snapScrew(input, spots, +p.x.toFixed(1), +p.y.toFixed(1)) };
  }
  const hw = opts.hardware ?? kDefaultHardware;
  const dir = edgeDir(p, { w, h });
  const side: BoardSide = dir.x === 1 ? 'left' : dir.x === -1 ? 'right' : dir.y === 1 ? 'bottom' : 'top';
  const along = side === 'left' || side === 'right';
  return { kind, side, at: Math.round(Math.max(hw.clamp.w / 2, Math.min((along ? h : w) - hw.clamp.w / 2, along ? p.y : p.x))) };
}

/** A part at this spot keeps clear of the board's fixtures: its real outline, with room for the cut. */
function clearOfHolds(nest: Pick<BoardNest, 'holds' | 'bit'>, inst: PartInstance, at: PartPosition) {
  const r = placedRect(at, inst);
  const turn = (loops: [number, number][][]) =>
    at.rotated ? loops.map(l => l.map(([x, y]): [number, number] => [inst.size[1] - y, x])) : loops;
  const rect: [number, number][] = [
    [0, 0],
    [inst.size[0], 0],
    [inst.size[0], inst.size[1]],
    [0, inst.size[1]],
  ];
  const part: SettlePart = {
    id: inst.id,
    w: r.w,
    h: r.h,
    outer: turn(inst.outline?.outer ?? [rect]),
    holes: turn(inst.outline?.holes ?? []),
  };
  return nest.holds.every(h => {
    const box = h.kind === 'screw' ? { x: h.x, y: h.y, w: 0, h: 0, r: h.d / 2 } : { ...holdBox(h), r: 0 };
    return partDist(box, part, at) >= pathClearance(h, nest.bit / 2) + nest.bit / 2 - 1e-6;
  });
}

/** Where a dragged body would land on a board, and the board after dropping it there. */
export interface PartDrop {
  /** Lower left corner where it lands; null: it fits nowhere on this board. */
  at: PartPosition | null;
  /** Lands exactly at the drop point (stored as its position), or where the board's nest puts it. */
  exact: boolean;
  /** The board with the body on it (unchanged when it doesn't fit). */
  board: BoardV1;
}

/**
 * Drop a body (from this board or another one of the same thickness) with its lower left corner at `at`. Close to where
 * the nest would put it among the others (within `snap` mm), it goes there. Otherwise, when that spot is free (inside the
 * margin, `gap` away from the other parts, clear of the fixtures) it stays exactly there. Else it goes where the nest
 * puts it, or nowhere when it doesn't fit. Pinned either way; the other parts stay where they are.
 */
export function dropPart(
  board: BoardV1,
  instances: PartInstance[],
  bit: number,
  item: string,
  at: PartPosition,
  snap = 0,
  opts: NestOptions = {}
): PartDrop {
  const inst = instances.find(i => i.id === item);
  if (!inst) return { at: null, exact: false, board };
  const same = board.items.includes(item);
  const now = nestBoard(board, instances, bit, opts);
  const others = now.placements.filter(p => p.id !== item);
  const rest = Object.fromEntries(others.map(p => [p.id, { x: p.x, y: p.y, rotated: p.rotated }]));
  const pinned = (board.pinned ?? []).filter(id => id !== item);
  const nested: BoardV1 = {
    ...board,
    items: same ? board.items : [...board.items, item],
    pinned: same && !board.pinned?.includes(item) ? pinned : [...pinned, item],
    ...(others.length && { layout: { w: now.board.w, h: now.board.h, at: rest } }),
  };
  if (!others.length) delete nested.layout;
  const placedAt = nestBoard(nested, instances, bit, { ...opts, holds: false });
  const nestAt = placedAt.placements.find(p => p.id === item);
  const snapped = (): PartDrop =>
    nestAt
      ? {
          at: { x: nestAt.x, y: nestAt.y, rotated: nestAt.rotated },
          exact: false,
          board: {
            ...nested,
            layout: {
              w: placedAt.board.w,
              h: placedAt.board.h,
              at: { ...rest, [item]: { x: nestAt.x, y: nestAt.y, rotated: nestAt.rotated } },
            },
          },
        }
      : { at: null, exact: false, board };
  if (nestAt && Math.hypot(nestAt.x - at.x, nestAt.y - at.y) <= snap && nestAt.rotated === at.rotated) return snapped();
  const r = placedRect(at, inst);
  const free =
    insideMargin(r, now.margin, now.board) &&
    others.every(p => apart(r, placedRect(p, instances.find(i => i.id === p.id)!), now.gap)) &&
    clearOfHolds(now, inst, at);
  if (free)
    return {
      at,
      exact: true,
      board: { ...nested, pinned: [...pinned, item], layout: { w: now.board.w, h: now.board.h, at: { ...rest, [item]: at } } },
    };
  return snapped();
}

/**
 * A body dragged to `at` on the board as nested: is that spot free (inside the margin, `gap` from the other parts, clear
 * of the fixtures)? A quick check while dragging; `dropPart` decides on the drop.
 */
export function spotFree(nest: BoardNest, instances: PartInstance[], item: string, at: PartPosition): boolean {
  const inst = instances.find(i => i.id === item);
  if (!inst) return false;
  const r = placedRect(at, inst);
  const others = nest.placements.filter(p => p.id !== item).map(p => placedRect(p, instances.find(i => i.id === p.id)!));
  return insideMargin(r, nest.margin, nest.board) && others.every(o => apart(r, o, nest.gap)) && clearOfHolds(nest, inst, at);
}

/** The board's second side: as chosen, else re-align with the camera when a part on it has features underneath. */
export function flipOf(board: BoardV1, instances: PartInstance[]): FlipRegistration | 'off' {
  if (board.flip) return board.flip;
  return instances.some(i => board.items.includes(i.id) && i.needsFlip) ? 'camera' : 'off';
}

export function boardRequest(
  board: BoardV1,
  nest: BoardNest,
  instances: PartInstance[],
  hold: { skin?: number; holes?: Record<string, Record<number, HoleChoice>> } = {}
): BoardRequest {
  const byId = new Map(instances.map(i => [i.id, i]));
  return {
    id: board.id,
    name: board.name,
    w: nest.board.w,
    h: nest.board.h,
    thickness: board.thickness,
    stockTop: stockTopOf(board),
    holdDown: holdDownOf(board),
    clearHoles: true,
    ...(board.taped && { taped: true }),
    holdPoints: nest.holds,
    tabs: board.tabs,
    ...(flipOf(board, instances) !== 'off' && {
      flip: { registration: flipOf(board, instances) as FlipRegistration, dowelDiameter: board.dowelDiameter },
    }),
    ...(hold.skin !== undefined && { skin: hold.skin }),
    parts: nest.placements.map(p => ({
      id: p.id,
      partId: byId.get(p.id)!.partId,
      name: byId.get(p.id)!.name,
      x: p.x,
      y: p.y,
      rotated: p.rotated,
      ...(board.tabsAt?.[p.id]?.length && { tabsAt: board.tabsAt[p.id] }),
      ...(hold.holes?.[byId.get(p.id)!.partId] && { holes: hold.holes[byId.get(p.id)!.partId] }),
    })),
  };
}

/**
 * A stock board as much of it fits on the machine: whole when it fits (either way round), else cut down to the work
 * area, lying the way that keeps the most of it.
 */
export function withinMachine<S extends { w: number; h: number }>(sheet: S, machine: { w: number; h: number }): S {
  if (fitsMachine(machine, sheet.w, sheet.h)) return sheet;
  const along = { w: Math.min(sheet.w, machine.w), h: Math.min(sheet.h, machine.h) };
  const across = { w: Math.min(sheet.w, machine.h), h: Math.min(sheet.h, machine.w) };
  const { w, h } = along.w * along.h >= across.w * across.h ? along : across;
  return { ...sheet, w: Math.floor(w), h: Math.floor(h) };
}

/**
 * Put every body on boards from the stock list, per thickness, using as little stock as possible (see `autoNest`).
 * Bodies the user moved by hand (`pinned`) stay on their board (at their spot, if placed there), and free bodies fill the room left on such a board
 * first when it has a fixed size. Thicknesses without stock keep their boards. No board comes out bigger than the
 * stock (nor the machine, when given): bodies left when the stock runs out (`short`) go on more boards of the stock's
 * sizes, and bodies that fit on no stock board (`tooBig`) on one board of the biggest size, where they don't fit.
 */
export function autoFillFromStock(
  boards: BoardV1[],
  instances: PartInstance[],
  stock: StockBoardV1[],
  bit: number,
  material: MaterialKey,
  objective: NestObjective = 'boards',
  /** The machine's work area: stock boards bigger than it are used cut down to it. */
  machine?: { w: number; h: number },
  /** Names no board here may take: those of the boards that stay out of this (cut ones). */
  reserved: string[] = []
): { boards: BoardV1[]; tooBig: string[]; short: string[] } {
  if (machine) stock = stock.map(s => withinMachine(s, machine));
  const out: BoardV1[] = [];
  const tooBig: string[] = [];
  const short: string[] = [];
  const byId = new Map(instances.map(i => [i.id, i]));
  const thicknesses = [...new Set(instances.map(i => thicknessKey(i.thickness)))].sort((a, b) => b - a);
  for (const t of thicknesses) {
    const sheets = stock.filter(s => thicknessKey(s.thickness) === t);
    const old = boards.filter(b => b.thickness === t);
    const mine = instances.filter(i => thicknessKey(i.thickness) === t).map(i => i.id);
    if (!sheets.length) {
      out.push(...(old.length ? old : [newBoard(out, t, material, mine)]));
      continue;
    }
    const template = { ...newBoard([], t, old[0]?.material ?? defaultMaterial(t, material)) };
    if (old[0]) Object.assign(template, holdSettingsOf(old[0]));
    const fresh = (items: string[], size: BoardV1['size']): BoardV1 => ({ ...template, id: crypto.randomUUID(), items, size });

    const kept = old.flatMap(b => {
      const pinned = (b.pinned ?? []).filter(id => b.items.includes(id) && mine.includes(id));
      if (!pinned.length) return [];
      return [{ ...b, items: pinned, pinned, ...(b.layout && { layout: { ...b.layout, at: onlyFor(b.layout.at, pinned) } }) }];
    });
    let free = mine.filter(id => !kept.some(b => b.items.includes(id)));
    const left = new Map(sheets.map(s => [s.id, s.quantity ?? Infinity]));
    for (const b of kept) {
      if (b.size.fit) continue;
      const { w, h } = b.size;
      const sheet = sheets.find(s => s.w === w && s.h === h && left.get(s.id)! > 0);
      if (sheet) left.set(sheet.id, left.get(sheet.id)! - 1);
      if (!free.length) continue;
      const placed = new Set(nestBoard({ ...b, items: [...b.items, ...free] }, instances, bit, { holds: false }).placements.map(p => p.id));
      const items = [...b.items, ...free.filter(id => placed.has(id))];
      if (!b.items.every(id => placed.has(id)) || nestBoard({ ...b, items }, instances, bit, { holds: false }).unplaced.length) continue;
      b.items = items;
      free = free.filter(id => !placed.has(id));
    }

    const pack: SheetPacker = (ids, sheet) => {
      const nest = nestBoard(fresh(ids, { fit: false, w: sheet.w, h: sheet.h }), instances, bit, { holds: false });
      return {
        placed: nest.placements.map(p => p.id),
        used: nest.placements.map(p => {
          const r = placedRect(p, byId.get(p.id)!);
          return { ...r, w: r.w + nest.gap, h: r.h + nest.gap };
        }),
      };
    };
    const res = autoNest(
      free.map(id => ({ id, w: byId.get(id)!.size[0], h: byId.get(id)!.size[1] })),
      sheets.map(s => ({ id: s.id, w: s.w, h: s.h, quantity: Number.isFinite(left.get(s.id)) ? left.get(s.id) : undefined })),
      pack,
      { objective }
    );
    const rebuiltFrom = out.length + kept.length;
    out.push(...kept, ...res.boards.map(b => fresh(b.items, { fit: false, w: b.sheet.w, h: b.sheet.h })));
    // Never a board bigger than the stock: parts left when the stock ran out go on more boards of the stock's sizes
    // (to buy), and parts too big for any of them on one board of the biggest size, where they show as not fitting.
    if (res.short.length) {
      const more = autoNest(
        res.short.map(id => ({ id, w: byId.get(id)!.size[0], h: byId.get(id)!.size[1] })),
        sheets.map(s => ({ id: s.id, w: s.w, h: s.h })),
        pack,
        { objective }
      );
      out.push(...more.boards.map(b => fresh(b.items, { fit: false, w: b.sheet.w, h: b.sheet.h })));
    }
    if (res.tooBig.length) {
      const biggest = sheets.reduce((a, s) => (s.w * s.h > a.w * a.h ? s : a));
      out.push(fresh(res.tooBig, { fit: false, w: biggest.w, h: biggest.h }));
    }
    // The boards made here take over the names the user gave the ones they replace.
    const names = old.filter(b => boardLabel(b) === b.name && !kept.some(k => k.id === b.id)).map(b => b.name);
    out.slice(rebuiltFrom).forEach((b, i) => {
      if (names[i]) b.name = names[i];
    });
    tooBig.push(...res.tooBig);
    short.push(...res.short);
  }
  // A fresh layout: name the boards A, B, C… in order (kept boards of other thicknesses too, so names stay unique).
  // Boards with parts placed by hand keep their name, and so do boards the user named, and none takes a name that's `reserved`.
  const keepsName = (b: BoardV1) => !!b.pinned?.length || boardLabel(b) === b.name;
  const taken = new Set([...reserved, ...out.filter(keepsName).map(b => b.name)]);
  let k = 0;
  const named = out.map(b => {
    if (keepsName(b)) return b;
    while (taken.has(letter(k))) k++;
    return { ...b, name: letter(k++) };
  });
  return { boards: named, tooBig, short };
}

/** Do these holds stand around the middle of the placed parts? */
export function holdsSurroundWork(
  fixtures: Fixture[],
  nest: Pick<BoardNest, 'board' | 'placements'>,
  hw: HoldHardware,
  instances: PartInstance[]
) {
  const parts = nest.placements.flatMap(p => {
    const inst = instances.find(i => i.id === p.id);
    return inst ? [{ id: p.id, ...placedRect(p, inst) }] : [];
  });
  const work = workBox({ ...nest.board, parts }, Object.fromEntries(parts.map(p => [p.id, p])));
  return fixturesAround({ ...nest.board, sizes: { clampReach: hw.clamp.d, clampWidth: hw.clamp.w, screwD: hw.screw.d } }, work, fixtures);
}

/** Whether the holds stand around the work: the one thing the Boards step says about holding. It checks where, not force. */
export function holdVerdict(
  board: Pick<BoardV1, 'fixtures' | 'taped'>,
  nest: Pick<BoardNest, 'board' | 'placements'>,
  hw: HoldHardware,
  instances: PartInstance[]
): { tone: 'ok' | 'warn' | 'none'; text: string } {
  const fixtures = board.fixtures ?? [];
  const names = fixtureCount(fixtures);
  if (board.taped) return { tone: 'ok', text: names ? `${names} and tape.` : 'Tape holds this board.' };
  if (!fixtures.length) return { tone: 'none', text: 'Nothing fastens this board. If that’s the plan, you hold it down by hand.' };
  const around = holdsSurroundWork(fixtures, nest, hw, instances);
  return around
    ? {
        tone: 'ok',
        text: `${names} around the work’s middle, which should stop it turning. Force isn’t checked here. The Plan step checks each piece as it’s cut.`,
      }
    : {
        tone: 'warn',
        text: `${names}: the board can still turn. A hold on the other side of the work’s middle would help. This is a note, not a block.`,
      };
}

/** What a change to the layout did: "Part 1, Part 3 move 15 mm right. Board size unchanged." */
export function layoutChange(
  before: Pick<BoardNest, 'board' | 'placements'>,
  after: Pick<BoardNest, 'board' | 'placements'>,
  instances: PartInstance[]
) {
  const moved = after.placements.flatMap(p => {
    const q = before.placements.find(x => x.id === p.id);
    return q && Math.hypot(p.x - q.x, p.y - q.y) > 0.5
      ? [{ name: instances.find(i => i.id === p.id)?.name ?? p.id, dx: p.x - q.x, dy: p.y - q.y }]
      : [];
  });
  const grew = after.board.w > before.board.w || after.board.h > before.board.h;
  if (!moved.length && !grew) return 'Fits as is. No part moves.';
  const [m] = moved;
  const how =
    m &&
    `${moved.map(x => x.name).join(', ')} ${moved.length > 1 ? 'move' : 'moves'} ${Math.round(Math.hypot(m.dx, m.dy))} mm ${
      Math.abs(m.dx) >= Math.abs(m.dy) ? (m.dx > 0 ? 'right' : 'left') : m.dy > 0 ? 'up' : 'down'
    }.`;
  return `${how ?? ''} ${grew ? `Board grows to ${after.board.w} × ${after.board.h}.` : 'Board size unchanged.'}`.trim();
}

/** Bounding rectangle of a placed body (for hit testing / labels). */
export function placedRect(p: { x: number; y: number; rotated: boolean }, inst: PartInstance): Rect {
  const s = placedSize({ id: inst.id, w: inst.size[0], h: inst.size[1] }, p.rotated);
  return { x: p.x, y: p.y, w: s.w, h: s.h };
}

/** "2 boards, 81 % yield": boards with parts on them, and part area over their board area. */
export function layoutSummary(boards: { nest: Pick<BoardNest, 'board' | 'yield' | 'placements'> }[]) {
  const used = boards.filter(b => b.nest.placements.length);
  if (!used.length) return 'No part placed yet.';
  const area = used.reduce((a, b) => a + b.nest.board.w * b.nest.board.h, 0);
  const parts = used.reduce((a, b) => a + b.nest.yield * b.nest.board.w * b.nest.board.h, 0);
  return `${used.length} ${used.length === 1 ? 'board' : 'boards'}, ${Math.round((100 * parts) / Math.max(area, 1e-9))} % yield`;
}
