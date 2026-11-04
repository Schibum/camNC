import type { BoardRequest, CamPartInfo, Outline2D, PlanResult } from '../camTypes';
import type { BoardOverlay, QueueEntry } from './camMachine';
import { entrySide } from './camMachine';

type Loop = [number, number][];

/** A part as seen from above, in program coordinates: outlines with their holes, and pocket regions. */
export interface GhostPart {
  name: string;
  shapes: { outline: Loop; holes: Loop[] }[];
  pockets: Loop[];
}

/** What the top view shows besides the loaded program: the whole parts, and what the board's other programs cut. */
export type ShowInTopView = 'program' | 'parts' | 'all';

function inside([x, y]: [number, number], loop: Loop) {
  let hit = false;
  for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
    const [xi, yi] = loop[i];
    const [xj, yj] = loop[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

/**
 * The board's parts where the program cuts them: placed as nested (part frame -> board frame, as `partToBoard`), on
 * side B turned over top to bottom (y -> H - y, as `sideBSpec`), then turned like the program about the XY zero.
 * Pockets only on side A: turned over, they are underneath.
 */
export function ghostParts(board: Pick<BoardRequest, 'h' | 'parts'>, parts: CamPartInfo[], side: 'a' | 'b', deg: number): GhostPart[] {
  const byId = new Map(parts.map(p => [p.id, p]));
  const a = (deg * Math.PI) / 180;
  const [c, s] = [Math.cos(a), Math.sin(a)];
  return board.parts.flatMap(placed => {
    const part = byId.get(placed.partId);
    if (!part) return [];
    const f = ([x, y]: [number, number]): [number, number] => {
      const [bx, y0] = placed.rotated ? [placed.x + part.size[1] - y, placed.y + x] : [placed.x + x, placed.y + y];
      const by = side === 'b' ? board.h - y0 : y0;
      return [bx * c - by * s, bx * s + by * c];
    };
    const map = (o: Outline2D) => o.filter(l => l.length > 2).map(l => l.map(f));
    const shapes = map(part.shape.outlines).map(outline => ({ outline, holes: [] as Loop[] }));
    for (const hole of map(part.shape.holes)) {
      (shapes.find(sh => inside(hole[0], sh.outline)) ?? shapes[0])?.holes.push(hole);
    }
    const pockets = side === 'a' ? part.shape.pockets.flatMap(p => map(p.region)) : [];
    return [{ name: placed.name, shapes, pockets }];
  });
}

/**
 * The cutting moves of every program on the side of the board an entry is cut on (program coordinates), for the
 * top view's "all programs". None for a program cut on a side whose programs aren't known (a turned release without
 * a side B).
 */
export function sidePath(e: QueueEntry): PlanResult['path'] | undefined {
  if (!e.plan) return undefined;
  if (entrySide(e) === 'a') return e.plan.path;
  // Side B entries and turning over carry side B's plan; a turned release carries the board's.
  if (e.sideB || e.kind === 'flip') return e.plan.path;
  return e.plan.sideB?.path;
}

/** The part shapes and other programs for an entry's overlay. */
export function entryGhost(e: QueueEntry, parts: CamPartInfo[] | undefined, deg: number): Pick<BoardOverlay, 'parts' | 'path'> {
  return {
    ...(parts && { parts: ghostParts(e.board.request, parts, entrySide(e), deg) }),
    path: sidePath(e),
  };
}
