import { orderBoardQueue } from '@wbcnc/cam/board';
import { create } from 'zustand';
import { combine, persist } from 'zustand/middleware';
import type { TabStop } from '@wbcnc/cam';
import type { PlanResult } from '../camTypes';
import type { JobBoard } from '../useJobBoards';

export interface BoardOverlay {
  w: number;
  h: number;
  rotationDeg: number;
  /** Guided tab removal: the tabs and where to hold the part, in program coordinates. */
  tabs?: TabStop[];
}

/** The CAM job being cut at the machine: which program is loaded, what's done, how each board lies on the bed. */
export const useCamMachine = create(
  persist(
    combine(
      {
        jobId: null as string | null,
        /** Queue entry keys (see `machineQueue`) already cut. */
        done: [] as string[],
        /** The entry loaded into the machine view. */
        active: null as string | null,
        /** Board id -> rotation in degrees (counterclockwise), for boards lying askew. */
        rotation: {} as Record<string, number>,
        /** What the top view draws for the loaded program: the board outline and, for tab removal, the tabs. */
        overlay: null as BoardOverlay | null,
      },
      set => ({
        start: (jobId: string) => set(s => (s.jobId === jobId ? s : { jobId, done: [], active: null, rotation: {}, overlay: null })),
        leave: () => set({ jobId: null, done: [], active: null, rotation: {}, overlay: null }),
        setActive: (active: string | null) => set({ active }),
        markDone: (key: string) => set(s => ({ done: s.done.includes(key) ? s.done : [...s.done, key] })),
        setRotation: (boardId: string, deg: number) => set(s => ({ rotation: { ...s.rotation, [boardId]: deg } })),
        setOverlay: (overlay: BoardOverlay | null) => set({ overlay }),
      })
    ),
    { name: 'camnc-cam-machine' }
  )
);

export interface QueueEntry {
  /** `${boardId}:bit:${index}`, `${boardId}:flip`, `${boardId}:b:bit:${index}` or `${boardId}:tabs`. */
  key: string;
  board: JobBoard;
  /** A program for one bit, turning the board over for side B, or the guided tab removal. */
  kind: 'bit' | 'flip' | 'tabs';
  /** The board's second side (turned over): `plan` is side B's. */
  sideB?: boolean;
  /** How side B lines up (flip and side B entries). */
  flip?: PlanResult['flip'];
  /** For bits: which of the board's programs. */
  program: number;
  /** The first entry of its board: place and align the board first. */
  firstOfBoard: boolean;
  plan: PlanResult;
}

/**
 * What to cut, in order: boards in the order that keeps the bit in the collet, per board one entry per bit, then
 * the guided tab removal for "tabs + guided removal" boards.
 */
export function machineQueue(boards: JobBoard[], plans: (PlanResult | undefined)[]): QueueEntry[] {
  const ready = boards
    .map((b, i) => ({ board: b, plan: plans[i], bits: plans[i]?.bits ?? [] }))
    .filter(e => e.plan && e.board.request.parts.length);
  const ordered = orderBoardQueue(ready, Math.min(...ready.flatMap(e => e.bits.slice(0, 1))));
  return ordered.flatMap(({ board, plan }) => [
    ...plan!.programs.map((_, program) => ({
      key: `${board.board.id}:bit:${program}`,
      board,
      kind: 'bit' as const,
      program,
      firstOfBoard: program === 0,
      plan: plan!,
    })),
    // Side B: turn the board over, then its own programs, one per bit.
    ...(plan!.sideB
      ? [
          {
            key: `${board.board.id}:flip`,
            board,
            kind: 'flip' as const,
            program: 0,
            firstOfBoard: false,
            plan: plan!.sideB,
            flip: plan!.flip,
          },
          ...plan!.sideB.programs.map((_, program) => ({
            key: `${board.board.id}:b:bit:${program}`,
            board,
            kind: 'bit' as const,
            sideB: true,
            flip: plan!.flip,
            program,
            firstOfBoard: false,
            plan: plan!.sideB!,
          })),
        ]
      : []),
    ...(board.board.holdDown === 'tabs-guided'
      ? [{ key: `${board.board.id}:tabs`, board, kind: 'tabs' as const, program: 0, firstOfBoard: false, plan: plan! }]
      : []),
  ]);
}

/**
 * The tab the guided removal program is at: the last "Tab k of N" pause read so far (FluidNC's SD percent). 0 before
 * the first.
 */
export function currentTab(gcode: string, percent: number): number {
  const bytes = new TextEncoder().encode(gcode).length;
  const read = (percent / 100) * bytes;
  let tab = 0,
    offset = 0;
  for (const line of gcode.split('\n')) {
    offset += new TextEncoder().encode(line).length + 1;
    if (offset > read + 2) break;
    const m = line.match(/^M0 \(MSG Tab (\d+) of/);
    if (m) tab = +m[1];
  }
  return tab;
}

/** "Board A · T2 ⌀6", "Board B · ⌀3.175", "Board A · remove tabs". */
export function entryTitle(e: QueueEntry) {
  const board = `Board ${e.board.board.name}`;
  if (e.kind === 'tabs') return `${board} · remove tabs`;
  if (e.kind === 'flip') return `${board} · turn over`;
  const p = e.plan.programs[e.program];
  const side = e.sideB ? ' side B' : '';
  return e.plan.programs.length > 1 ? `${board}${side} · T${p.tool} ⌀${p.diameter}` : `${board}${side} · ⌀${p.diameter}`;
}
