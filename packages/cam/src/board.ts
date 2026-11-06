import { readGcode } from './analyze';
import { toolProgramKey } from './toolIdentity';
import { pocketOperationClashes, tangentEntryClashes } from './boardEntrySafety';
import { finalizePlan } from './finalizePlan';
import { geometryTolerances } from './accuracy';
import { openPocketRegion, type PartFeatures } from './features';
import { dowelOperations, partRect, type DowelSpec } from './flip';
import { toGcode } from './gcode';
import { boardToPart, kDefaultSkin, planTabs, type PartHolding } from './tabPlan';
import type { Vec3 } from './geom';
import type { BottomLayer, HoldOptions } from './hold';
import { holdBox, holdClashes, holdHeight, type HoldPoint } from './holdPoints';
import { estimateProgramTime } from './timing';
import {
  camPart,
  DEFAULT_SETTINGS,
  DEFAULT_TABS,
  fluteWarnings,
  type CamSettings,
  type HoleChoice,
  type HoleMiddle,
  type Operation,
  type PartCam,
  type TabSettings,
} from './toolpaths';

/**
 * How the parts are held while cutting. `tabs` / `tabs-guided`: tabs into stock that reaches the board's edge (removed
 * by hand, or by a guided program). `skin`: every outline stops a skin above the board's bottom, and the parts are cut
 * free one at a time at the machine. `fixture-tape`: a skin on a taped board: every outline stops a thin layer above the
 * bottom, cut for all parts together at the very end. `none`: nothing holds them once cut. How the board itself is held:
 * `BoardSpec.holdPoints` (screws or clamps), `BoardSpec.taped`, or by hand.
 */
export type HoldDown = 'fixture-tape' | 'tabs' | 'tabs-guided' | 'skin' | 'none';

/** Hold-downs that leave a layer under every part and cut it for all parts together at the end. */
export const releasesAtEnd = (holdDown: HoldDown) => holdDown === 'skin' || holdDown === 'fixture-tape';

export interface BoardPart {
  /** Unique on the board (one per body: two identical shelves are two parts). */
  id: string;
  name: string;
  features: PartFeatures;
  /**
   * With a side B: the part's underside as side B cuts it (see `sideBSpec`), so tabs and skins keep clear of its pockets.
   */
  underside?: PartFeatures;
  /** Part size laid flat (before turning). */
  size: Vec3;
  /**
   * Tabs the user placed, part frame (as laid flat, before turning), mm: used instead of picked ones, each moved onto
   * the bit's path round the outline.
   */
  tabsAt?: { x: number; y: number }[];
  /** With the board's `clearHoles`: the user's choice per through hole, over what its size and time would pick. */
  holes?: Record<number, HoleChoice>;
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
  /** Clear the piece in the middle of a through hole where that's quick, and report what happens to each (`holeMiddles`). */
  clearHoles?: boolean;
  /** A flip on dowel pins: side A drills the pin holes (board and spoilboard) before anything else. */
  dowels?: DowelSpec;
  /** Tape under the board: all of it stays put, whatever the hold points. */
  taped?: boolean;
  /**
   * Bottom skin thickness, mm (default 1): for the `skin` hold-down, and the layer left on the tape for `fixture-tape`.
   */
  skin?: number;
  /**
   * Where the board is screwed or clamped down. Empty: nothing fastens it, the user holds it down. Not given: held at
   * its edges (a fence, a fixture).
   */
  holdPoints?: HoldPoint[];
}

/** What holds the stock, for the hold checks: the hold points (none: nothing), the tape, or (neither) the board's edge. */
export function holdOptionsOf(
  board: Pick<BoardSpec, 'holdDown' | 'holdPoints'> & Partial<Pick<BoardSpec, 'parts' | 'h' | 'stockTop' | 'taped'>>,
  settings: Partial<CamSettings> = {}
): HoldOptions {
  const layer =
    board.parts && board.h !== undefined ? bottomLayer({ parts: board.parts, h: board.h, stockTop: board.stockTop }, settings) : undefined;
  return {
    ...(board.holdPoints && { points: board.holdPoints.map(p => ({ x: p.x, y: p.y })) }),
    ...(layer && { layer }),
    ...((board.taped || board.holdDown === 'fixture-tape') && { taped: true }),
  };
}

/**
 * What the pockets of both sides leave of the board's bottom, where tabs and skins are (see `BottomLayer`). Open pockets
 * count as far past the outline as the largest bit runs them. Undefined without any pocket.
 */
function bottomLayer(board: Pick<BoardSpec, 'parts' | 'h' | 'stockTop'>, settings: Partial<CamSettings>): BottomLayer | undefined {
  type Area = { loops: { x: number; y: number }[][]; x0: number; y0: number; x1: number; y1: number; from: number; to: number };
  const areas: Area[] = [];
  const ext = Math.max(...(settings.tools ?? DEFAULT_SETTINGS.tools).map(t => t.diameter)) / 2 + 1;
  const add = (features: PartFeatures, toBoard: (q: Vec3) => Vec3, cut: (floorZ: number) => { from: number; to: number }) => {
    for (const pocket of features.pockets) {
      const loops = openPocketRegion(
        features.outlines,
        pocket,
        ext,
        geometryTolerances(settings.geometryTolerance, settings.sourceTolerance)
      ).map(loop =>
        loop.map(q => {
          const [x, y] = toBoard([q.x, q.y, 0]);
          return { x, y };
        })
      );
      const pts = loops.flat();
      if (!pts.length) continue;
      areas.push({
        loops,
        x0: Math.min(...pts.map(q => q.x)),
        y0: Math.min(...pts.map(q => q.y)),
        x1: Math.max(...pts.map(q => q.x)),
        y1: Math.max(...pts.map(q => q.y)),
        ...cut(pocket.floorZ),
      });
    }
  };
  for (const part of board.parts) {
    add(
      part.features,
      q => partToBoard(part, q),
      to => ({ from: 0, to })
    );
    if (!part.underside) continue;
    // Where side B cuts it, turned back to how side A lies: board y -> H - y, and a floor at Z in side B's frame leaves
    // everything above stockTop - Z. Its features' depths are measured from the stock's top, whatever the stock.
    const r = partRect(part);
    const turned = { ...part, y: board.h - r.y - r.h };
    const stockTop = board.stockTop ?? part.underside.thickness;
    add(
      part.underside,
      q => {
        const [x, y, z] = partToBoard(turned, q);
        return [x, board.h - y, z];
      },
      floorZ => ({ from: stockTop - floorZ, to: Infinity })
    );
  }
  if (!areas.length) return undefined;
  return p => {
    let from = 0,
      to = Infinity;
    for (const a of areas) {
      if (p.x < a.x0 || p.x > a.x1 || p.y < a.y0 || p.y > a.y1 || !insideLoops(p, a.loops)) continue;
      from = Math.max(from, a.from);
      to = Math.min(to, a.to);
    }
    return { from, to };
  };
}

/** Inside loops (outer and holes, either way round), by crossing parity. */
function insideLoops(p: { x: number; y: number }, loops: { x: number; y: number }[][]) {
  let c = false;
  for (const poly of loops)
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[i],
        b = poly[j];
      if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) c = !c;
    }
  return c;
}

/**
 * Clearance heights of a board's programs: rapids and retract links pass above the stock and tallest hold, wherever
 * they go (and wherever the machine starts from), by the configured heights.
 */
function aboveHolds(
  board: Pick<BoardSpec, 'holdPoints'>,
  stockTop: number,
  settings: Partial<CamSettings>
): Pick<PartCam, 'safeZ' | 'retractZ'> {
  const top = stockTop + Math.max(0, ...(board.holdPoints ?? []).map(holdHeight));
  return {
    safeZ: top + (settings.safeHeight ?? DEFAULT_SETTINGS.safeHeight),
    retractZ: top + (settings.retractHeight ?? DEFAULT_SETTINGS.retractHeight),
  };
}

/**
 * Holds in the way of a job's programs, every move as the G-code has it: cuts, links, rapids and the way back to X0 Y0.
 * `turned`: a program for the board turned over, whose holds are back in the same spots on the wood (x, H - y on the
 * bed). The board may lie askew, turned over at its own angle: back to the holds' frame first.
 */
export function jobHoldClashes(
  board: Pick<BoardSpec, 'h' | 'rotationDeg' | 'holdPoints'> & { sideBRotationDeg?: number },
  stockTop: number,
  programs: { gcode: string; diameter: number; turned?: boolean }[]
): HoldPoint[] {
  const holds = board.holdPoints ?? [];
  if (!holds.length) return [];
  const backA = rotateAboutOrigin(-(board.rotationDeg ?? 0));
  const backB = rotateAboutOrigin(-(board.sideBRotationDeg ?? board.rotationDeg ?? 0));
  const paths = programs.map(p => {
    // The first move only says where the machine goes: it starts wherever it is, and goes straight up.
    const moves = readGcode(p.gcode).slice(1);
    const back = p.turned ? backB : backA;
    return {
      turned: !!p.turned,
      cut: { r: p.diameter / 2, pts: moves.length ? [back(moves[0].from), ...moves.map(m => back(m.to))] : [] },
    };
  });
  const asLaid = paths.filter(p => !p.turned).map(p => p.cut);
  const turned = paths.filter(p => p.turned).map(p => p.cut);
  return holds.filter(
    h =>
      holdClashes([h], asLaid, stockTop).length > 0 ||
      holdClashes([{ ...h, y: board.h - h.y, ...(h.dir && { dir: { x: h.dir.x, y: -h.dir.y } }) }], turned, stockTop).length > 0
  );
}

/**
 * Holds sitting on a part, inside its outline: no cut comes near one in the middle of a part, so `jobHoldClashes` can't
 * see it, but it goes through the finished part.
 */
export function holdsOnParts(board: Pick<BoardSpec, 'parts' | 'holdPoints'>): HoldPoint[] {
  return (board.holdPoints ?? []).filter(h => {
    const b = holdBox(h);
    const pts = [
      { x: h.x, y: h.y },
      { x: b.x, y: b.y },
      { x: b.x + b.w, y: b.y },
      { x: b.x, y: b.y + b.h },
      { x: b.x + b.w, y: b.y + b.h },
    ];
    return board.parts.some(part => {
      // On the piece in a hole's middle: not on the part. Its cuts are checked like any other (`holdClashes`).
      const holes = part.features.throughHoles.map(loop =>
        loop.map(q => {
          const [x, y] = partToBoard(part, [q.x, q.y, 0]);
          return { x, y };
        })
      );
      const region = [
        ...part.features.outlines.map(loop =>
          loop.map(q => {
            const [x, y] = partToBoard(part, [q.x, q.y, 0]);
            return { x, y };
          })
        ),
        ...holes,
      ];
      return pts.some(p => insideLoops(p, region));
    });
  });
}

/** The through holes of a part with a hold point on the piece in their middle. */
function screwedHoles(part: BoardPart, points: HoldPoint[]) {
  const holes = new Set<number>();
  part.features.throughHoles.forEach((loop, i) => {
    const onBoard = loop.map(q => {
      const [x, y] = partToBoard(part, [q.x, q.y, 0]);
      return { x, y };
    });
    if (points.some(h => insideLoops(h, [onBoard]))) holes.add(i);
  });
  return holes;
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

/** Placement moves cutting-transition evidence into the same frame as its actual toolpath. */
function transformOperation(operation: Operation, transform: (point: Vec3) => Vec3): Operation {
  return {
    ...operation,
    ...(operation.pocketTransition && {
      pocketTransition: {
        ...operation.pocketTransition,
        region: operation.pocketTransition.region.map(loop =>
          loop.map(point => {
            const [x, y] = transform([point.x, point.y, 0]);
            return { x, y };
          })
        ),
        ...(operation.pocketTransition.retainedSolid && {
          retainedSolid: operation.pocketTransition.retainedSolid.map(loop =>
            loop.map(point => {
              const [x, y] = transform([point.x, point.y, 0]);
              return { x, y };
            })
          ),
        }),
      },
    }),
    passes: operation.passes.map(pass => ({
      ...pass,
      pts: pass.pts.map(transform),
      ...(pass.cuttingTransition && {
        cuttingTransition: {
          ...pass.cuttingTransition,
          from: transform(pass.cuttingTransition.from),
          to: transform(pass.cuttingTransition.to),
        },
      }),
    })),
  };
}

const kFeatureOrder = { pocket: 0, hole: 1, outline: 2 } as const;

/**
 * One program for a whole board: operations grouped by bit (smallest first, so the swap happens once per bit), and
 * per bit inner features (pockets, holes) of every part before any outline, so no part comes loose while others are
 * still cut (with a skin or tape layer: every bit's inner features before any outline). Parts follow each other
 * nearest-first.
 */
export function camBoard(board: BoardSpec, settings: Partial<CamSettings>): PartCam {
  const tabs = usesTabs(board.holdDown) ? (board.tabs ?? DEFAULT_TABS) : false;
  const stockTop = board.stockTop ?? board.thickness;
  const turn = rotateAboutOrigin(board.rotationDeg ?? 0);
  const warnings: string[] = [];
  const ops: { op: Operation; part: BoardPart; index: number }[] = [];
  const holeMiddles: HoleMiddle[] = [];
  // Tabs only where they hold; the others are cut without, and the job is blocked until that's dealt with.
  const holding = tabs
    ? planTabs(board, settings)
    : releasesAtEnd(board.holdDown)
      ? new Map(board.parts.map(p => [p.id, { id: p.id, name: p.name, how: 'skin' as const, tabs: [] }]))
      : undefined;
  const layer = board.skin ?? kDefaultSkin;
  for (const part of board.parts) {
    const h = holding?.get(part.id);
    const own: Partial<CamSettings> =
      h?.how === 'placed' && tabs
        ? { tabs: { ...tabs, centers: h.tabs.map(q => boardToPart(part, q)) } }
        : h?.how === 'skin'
          ? { tabs: false, outlineFloor: layer }
          : h?.how === 'unheld'
            ? { tabs: false }
            : {};
    const requested: Partial<CamSettings> = { ...settings, tabs, stockTop, ...own };
    // Future holes in a neighbor are not proved cleared stock; protect its complete outer silhouette.
    const pocketNeighbors = board.parts
      .filter(other => other.id !== part.id)
      .flatMap(other =>
        other.features.outlines.map(loop =>
          loop.map(point => {
            const [x, y] = partToBoard(other, [point.x, point.y, 0]);
            return { x, y };
          })
        )
      );
    // The path budget includes its own source scope; the neighbor's independently declared boundary may also move.
    // An omitted source tolerance keeps this a nominal-feature check, not an independently certified CAD bound.
    const context = {
      ...(pocketNeighbors.length && {
        pocketClashes: (operation: Operation) =>
          pocketOperationClashes(
            operation,
            pocketNeighbors,
            point => partToBoard(part, point),
            (requested.geometryTolerance ?? DEFAULT_SETTINGS.geometryTolerance ?? 0.05) + (requested.sourceTolerance ?? 0)
          ),
      }),
      ...(board.clearHoles && {
        holeMiddles: {
          choices: part.holes,
          screwed: screwedHoles(part, board.holdPoints ?? []),
          minutes: (operation: Operation) =>
            estimateProgramTime(toGcode({ stockTop, operations: [operation], warnings: [] })).estimatedAutomaticSeconds / 60,
        },
      }),
    };
    let cam = camPart(part.features, requested, context);
    if (requested.profileEntry === 'tangent') {
      const neighbors = board.parts
        .filter(other => other.id !== part.id)
        .flatMap(other =>
          other.features.footprint.map(loop =>
            loop.map(q => {
              const [x, y] = partToBoard(other, [q.x, q.y, 0]);
              return { x, y };
            })
          )
        );
      const tolerance =
        'geometryTolerance' in settings && typeof settings.geometryTolerance === 'number' ? settings.geometryTolerance : 0.05;
      if (tangentEntryClashes(cam, neighbors, q => partToBoard(part, q), tolerance)) {
        cam = camPart(part.features, { ...requested, profileEntry: 'ramp' }, context);
        cam.warnings.push('Tangent profile lead intersects a neighboring part; using contour ramps');
      }
    }
    warnings.push(...cam.warnings.map(w => `${part.name}: ${w}`));
    holeMiddles.push(...(cam.holeMiddles ?? []).map(m => ({ ...m, part: part.id })));
    cam.operations.forEach((op, index) =>
      ops.push({
        op: {
          ...transformOperation(op, q => turn(partToBoard(part, q))),
          name: `${part.name}: ${op.name}`,
        },
        part,
        index,
      })
    );
  }
  const diameters = [...new Set(ops.map(o => o.op.tool.diameter))].sort((a, b) => a - b);
  const operations: Operation[] = [];
  // Pin holes first, with the first bit: the board is still whole.
  if (board.dowels) {
    const pins = dowelOperations(board, board.dowels, settings);
    warnings.push(...fluteWarnings(pins, stockTop));
    operations.push(...pins.map(op => transformOperation(op, turn)));
  }
  let pos = { x: 0, y: 0 };
  // Per bit, inner features before outlines. When every part keeps a layer until the end, the inner features of every
  // bit come before any outline: no pocket is cut into a part whose outline is already down to its skin.
  const stages = releasesAtEnd(board.holdDown)
    ? [...diameters.map(d => ({ d, stage: 'inner' as const })), ...diameters.map(d => ({ d, stage: 'outline' as const }))]
    : diameters.flatMap(d => [
        { d, stage: 'inner' as const },
        { d, stage: 'outline' as const },
      ]);
  for (const { d, stage } of stages) {
    {
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
  const blank = [
    [
      [0, 0, 0],
      [board.w, 0, 0],
      [board.w, board.h, 0],
      [0, board.h, 0],
    ].map(point => {
      const q = turn(point as Vec3);
      return { x: q[0], y: q[1] };
    }),
  ];
  return finalizePlan(
    {
      stockTop,
      operations,
      warnings,
      ...(holding && { holding: [...holding.values()] }),
      ...(holeMiddles.length && { holeMiddles }),
      ...aboveHolds(board, stockTop, settings),
    },
    { ...DEFAULT_SETTINGS, ...settings },
    blank
  );
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
    if (last && toolProgramKey(last.operations[0].tool) === toolProgramKey(op.tool)) last.operations.push(op);
    else
      out.push({
        stockTop: cam.stockTop,
        safeZ: cam.safeZ,
        retractZ: cam.retractZ,
        accuracy: cam.accuracy,
        stockFootprint: cam.stockFootprint,
        stockSummary: cam.stockSummary,
        operations: [op],
        warnings: out.length ? [] : cam.warnings,
      });
  }
  return out;
}
