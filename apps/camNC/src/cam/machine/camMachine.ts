import { demoStorage } from '@/lib/demo/demo-storage';
import { orderBoardQueue } from '@wbcnc/cam/board';
import { create } from 'zustand';
import { combine, createJSONStorage, persist, type StateStorage } from 'zustand/middleware';
import type { TabStop } from '@wbcnc/cam';
import type { HoldPoint } from '@wbcnc/cam/holdPoints';
import { boardBlock, type BlockContext } from '../boardBlock';
import type { BoardCut } from '../boards';
import { useHoldHardware } from '../holdHardware';
import type { PlanResult, ReleaseProgram } from '../camTypes';
import type { JobBoard } from '../useJobBoards';
import type { GhostPart, ShowInTopView } from './partGhost';

export interface BoardOverlay {
  w: number;
  h: number;
  rotationDeg: number;
  /** Guided tab removal: the tabs and where to hold the part, in program coordinates. */
  tabs?: TabStop[];
  /** Tab removal pauses once per part (all its tabs, then "Take out"), not before every tab. */
  tabsPerPart?: boolean;
  /** Freeing bottom-skin parts: the parts in program order, a spot on each (program coordinates). */
  freeParts?: { name: string; at: { x: number; y: number } }[];
  /** The board the outline is of, and which side lies up: holds are edited on it, its spot on the bed saved with it. */
  boardId?: string;
  side?: 'a' | 'b';
  /** Side A: where the board is screwed or clamped (board frame, turned with the outline). */
  holds?: HoldPoint[];
  /** What a hold added here is like: the board's screw or clamp. */
  holdLike?: Pick<HoldPoint, 'kind' | 'd' | 'w' | 'height'>;
  /** The board's size as nested, mm: what the holds are placed on (edges a clamp grips), and saved with them. */
  holdsOn?: { w: number; h: number };
  /** Holds the program's bit would hit (board frame): drawn red. */
  holdClash?: { x: number; y: number }[];
  /** The program's bit, mm: how far its path stays from a hold. */
  bit?: number;
  /**
   * The cutting moves of every program on this side of the board (program coordinates) and the stock top: a hold being
   * dragged is checked against them at once, and the top view can draw them faint ("all programs").
   */
  path?: [number, number, number][][];
  stockTop?: number;
  /** The board's parts as seen from above (program coordinates): what the loaded program is lined up against. */
  parts?: GhostPart[];
}

/** A save that doesn't fit costs what's kept over a reload, never what's on screen: it must not throw into the UI. */
const forgivingLocalStorage: StateStorage = {
  getItem: name => demoStorage.getItem(name),
  setItem: (name, value) => {
    try {
      demoStorage.setItem(name, value);
    } catch (e) {
      console.warn(`Couldn't save ${name}`, e);
    }
  },
  removeItem: name => demoStorage.removeItem(name),
};

/** The CAM job being cut at the machine: which program is loaded, what's done, how each board lies on the bed. */
export const useCamMachine = create(
  persist(
    combine(
      {
        jobId: null as string | null,
        /** What's already cut: `doneId`s of queue entries, so a program that changed since counts as not cut. */
        done: [] as string[],
        /** The entry loaded into the machine view. */
        active: null as string | null,
        /** `rotationKey` -> rotation in degrees (counterclockwise), for boards lying askew. */
        rotation: {} as Record<string, number>,
        /** What the top view draws for the loaded program: the board outline and, for tab removal, the tabs. */
        overlay: null as BoardOverlay | null,
        /** Guided tab removal stops before every tab (hold the part), or once per part (take it out). */
        pauseEachTab: false,
        /** What the top view shows besides the loaded program: the whole parts (default), or every program too. */
        showInTopView: 'parts' as ShowInTopView,
      },
      set => ({
        /** Nothing is loaded for the job yet, also when taking the same job again. What's cut stays, while it's the same program. */
        start: (jobId: string) =>
          set(s => (s.jobId === jobId ? { active: null, overlay: null } : { jobId, done: [], active: null, rotation: {}, overlay: null })),
        leave: () => set({ jobId: null, done: [], active: null, rotation: {}, overlay: null }),
        setActive: (active: string | null) => set({ active }),
        markDone: (doneId: string) => set(s => ({ done: s.done.includes(doneId) ? s.done : [...s.done, doneId] })),
        setRotation: (key: string, deg: number) => set(s => ({ rotation: { ...s.rotation, [key]: deg } })),
        setOverlay: (overlay: BoardOverlay | null) => set({ overlay }),
        setPauseEachTab: (pauseEachTab: boolean) => set({ pauseEachTab }),
        setShowInTopView: (showInTopView: ShowInTopView) => set({ showInTopView }),
      })
    ),
    {
      name: 'camnc-cam-machine',
      // Version 1: once per part became the default, with the hand off the part while tabs are cut. Browsers saved the old
      // default without anyone choosing it.
      // Version 2: the overlay's path and parts aren't saved. A migration writes the state back, which frees what browsers
      // already saved of them (megabytes, up to a full quota).
      version: 2,
      migrate: (saved, version) => (version < 1 ? { ...(saved as object), pauseEachTab: false } : saved) as never,
      storage: createJSONStorage(() => forgivingLocalStorage),
      // The path and parts are megabytes, and made again from the job when the entry is shown after a reload.
      partialize: state => ({ ...state, overlay: state.overlay && { ...state.overlay, path: undefined, parts: undefined } }),
    }
  )
);

interface QueueEntryBase {
  /** `${boardId}:bit:${index}`, `${boardId}:flip`, `${boardId}:b:bit:${index}`, `${boardId}:tabs`, `${boardId}:error`… */
  key: string;
  /** `key` and the entry's program: marked done, a changed program is not done. */
  doneId: string;
  board: JobBoard;
  /** The board's second side (turned over): `plan` is side B's. */
  sideB?: boolean;
  /** How side B lines up (flip and side B entries). */
  flip?: PlanResult['flip'];
  /** For bits: which of the board's programs. */
  program: number;
  /** The first entry of its board: place and align the board first. */
  firstOfBoard: boolean;
  /** Freeing parts or the tab removal: the program planned with the board. */
  release?: ReleaseProgram;
  /** The bit the entries before this one end with, if any has one. */
  bitBefore?: number;
  /** Why this can't be loaded (a check of the board failed, its plan failed or isn't there yet). */
  blocked?: string;
}

export interface ProgramEntry extends QueueEntryBase {
  /** A program for one bit, turning the board over for side B, freeing bottom-skin parts, or the guided tab removal. */
  kind: 'bit' | 'flip' | 'free' | 'tabs';
  plan: PlanResult;
}

/** A board with no programs to show: planning failed or found nothing (`error`), or it's still running (`pending`). */
export interface NoProgramEntry extends QueueEntryBase {
  kind: 'error' | 'pending';
  plan?: undefined;
  blocked: string;
}

export type QueueEntry = ProgramEntry | NoProgramEntry;

/** What the queue knows beside the programs: what blocks a board, and why planning failed (per board, like `plans`). */
export interface QueueContext extends BlockContext {
  errors?: (string | undefined)[];
}

const contentHash = new WeakMap<object, string>();
/** FNV-1a and the length: tells a changed program, no more. Cached per program: they are megabytes, the queue is rebuilt often. */
function hashOf(program: { gcode: string }) {
  let hash = contentHash.get(program);
  if (!hash) {
    let h = 0x811c9dc5;
    for (let i = 0; i < program.gcode.length; i++) h = Math.imul(h ^ program.gcode.charCodeAt(i), 0x01000193);
    hash = `${(h >>> 0).toString(36)}-${program.gcode.length}`;
    contentHash.set(program, hash);
  }
  return hash;
}

/** The program of an entry, if it has one. Never the program of another entry. */
export function entryProgram(e: QueueEntry): { gcode: string; diameter: number } | undefined {
  if (!e.plan || e.kind === 'flip') return undefined;
  return e.release ?? e.plan.programs[e.program];
}

/**
 * What to cut, in order: boards in the order that keeps the bit in the collet, per board one entry per bit, then what
 * the plan has for after the cutting (freeing bottom-skin parts, the guided tab removal). Every board that should be
 * cut is in it: one that can't is there with `blocked`, why.
 */
export function machineQueue(boards: JobBoard[], plans: (PlanResult | undefined)[], context?: QueueContext): QueueEntry[] {
  const known = boards
    .map((b, i) => {
      const plan = plans[i];
      return {
        board: b,
        plan,
        bits: plan?.bits ?? [],
        blocked: (context && boardBlock(b, plan, context)) ?? undefined,
        error: context?.errors?.[i],
      };
    })
    // A board without placed parts has nothing to plan: only a reason, or it's not part of the job.
    .filter(e => e.board.request.parts.length || e.blocked);
  const ordered = orderBoardQueue(known, Math.min(...known.flatMap(e => e.bits.slice(0, 1))));
  const entries = ordered.flatMap(({ board, plan, blocked, error }): QueueEntry[] => {
    const id = board.board.id;
    const none = (kind: NoProgramEntry['kind'], why: string): NoProgramEntry[] => [
      { key: `${id}:${kind}`, doneId: `${id}:${kind}`, board, kind, program: 0, firstOfBoard: false, blocked: why },
    ];
    if (error) return none('error', `Couldn’t be planned: ${error}`);
    if (!plan) return blocked ? none('error', blocked) : none('pending', 'Making its programs…');
    if (!plan.programs.length) return none('error', blocked ?? 'Nothing to cut.');
    const common = { board, plan, blocked };
    return [
      ...plan.programs.map(
        (p, program): ProgramEntry => ({
          ...common,
          key: `${id}:bit:${program}`,
          doneId: `${id}:bit:${program}#${hashOf(p)}`,
          kind: 'bit',
          program,
          firstOfBoard: program === 0,
        })
      ),
      // Side B: turn the board over, then its own programs, one per bit.
      ...(plan.sideB
        ? [
            {
              ...common,
              key: `${id}:flip`,
              // Turned over after this side A: correcting how side B lies doesn't mean turning it again.
              doneId: `${id}:flip#${hashOf(plan)}`,
              kind: 'flip' as const,
              program: 0,
              firstOfBoard: false,
              plan: plan.sideB,
              flip: plan.flip,
            },
            ...plan.sideB.programs.map(
              (p, program): ProgramEntry => ({
                ...common,
                key: `${id}:b:bit:${program}`,
                doneId: `${id}:b:bit:${program}#${hashOf(p)}`,
                kind: 'bit',
                sideB: true,
                flip: plan.flip,
                program,
                firstOfBoard: false,
                plan: plan.sideB!,
              })
            ),
          ]
        : []),
      ...(plan.release ?? []).map(
        (release): ProgramEntry => ({
          ...common,
          key: `${id}:${release.kind}`,
          doneId: `${id}:${release.kind}#${hashOf(release)}`,
          kind: release.kind,
          program: 0,
          firstOfBoard: false,
          release,
        })
      ),
    ];
  });
  let bit: number | undefined;
  return entries.map(e => {
    const bitBefore = bit;
    bit = entryProgram(e)?.diameter ?? bit;
    return { ...e, bitBefore };
  });
}

/**
 * The entry the card is about: the active one; if that's gone (planned again into other entries, or planning failed)
 * the first one to cut of the same board, not of another board; else the first one to cut.
 */
export function currentEntry(queue: QueueEntry[], active: string | null, done: string[]): QueueEntry | null {
  const toCut = (e: QueueEntry) => !done.includes(e.doneId);
  const activeOne = queue.find(e => e.key === active);
  if (activeOne) return activeOne;
  const sameBoard = active ? queue.filter(e => active.startsWith(`${e.board.board.id}:`)) : [];
  return sameBoard.find(toCut) ?? queue.find(toCut) ?? null;
}

/** A board started over (Boards): what was marked done of it here is forgotten too, when it's this job at the machine. */
export function forgetCut(jobId: string, boardId: string) {
  const m = useCamMachine.getState();
  if (m.jobId !== jobId) return;
  useCamMachine.setState({ done: m.done.filter(d => !d.startsWith(`${boardId}:`)) });
}

/** What comes after `current`: the next entry to cut, or an earlier one left out. */
export function nextEntry(queue: QueueEntry[], current: QueueEntry, done: string[]): QueueEntry | null {
  const i = queue.indexOf(current);
  const toCut = (e: QueueEntry) => e !== current && !done.includes(e.doneId);
  return queue.slice(i + 1).find(toCut) ?? queue.slice(0, i).find(toCut) ?? null;
}

/** Which rotation an entry's program lies at: side B has its own, from turning the board over on. */
export const rotationKey = (e: QueueEntry) =>
  e.sideB || e.kind === 'flip' || e.release?.turned ? `${e.board.board.id}:b` : e.board.board.id;

/**
 * The angle of an entry's program: as turned here, else as saved with the job (the board's spot on the bed). Until
 * side B is corrected it lies like side A.
 */
export const entryRotation = (e: QueueEntry, rotation: Record<string, number>) => {
  const { id, bed } = e.board.board;
  const own = rotationKey(e) === id ? (rotation[id] ?? bed?.a?.deg) : (rotation[`${id}:b`] ?? bed?.b?.deg);
  return own ?? rotation[id] ?? bed?.a?.deg ?? 0;
};

/**
 * What's cut: the entries marked done here, and those the job says were cut (`BoardV1.cut`, kept with the job), also
 * after leaving it or on another visit. A program that changed since it was done counts as not cut, wherever it was marked.
 */
export function doneEntries(queue: QueueEntry[], done: string[]): string[] {
  const fromJob = queue.filter(e => e.board.board.cut?.keys.includes(e.doneId) && !done.includes(e.doneId)).map(e => e.doneId);
  return fromJob.length ? [...done, ...fromJob] : done;
}

/**
 * What the job should record as cut for each board whose cut changed: the entries done (added to what it has), and
 * whether every program of the board is. `null` when nothing changed.
 */
export function cutsToRecord(queue: QueueEntry[], done: string[], now = Date.now()): Record<string, BoardCut> | null {
  const out: Record<string, BoardCut> = {};
  const ids = [...new Set(queue.map(e => e.board.board.id))];
  for (const id of ids) {
    const mine = queue.filter(e => e.board.board.id === id);
    const board = mine[0].board.board;
    const programs = mine.filter(e => e.kind !== 'error' && e.kind !== 'pending');
    const keys = [...new Set([...(board.cut?.keys ?? []), ...programs.filter(e => done.includes(e.doneId)).map(e => e.doneId)])];
    if (!keys.length) continue;
    const all = programs.length > 0 && programs.every(e => keys.includes(e.doneId));
    if (board.cut && board.cut.keys.length === keys.length && !!board.cut.all === all) continue;
    out[id] = { at: board.cut?.keys.length ? board.cut.at : now, keys, ...(all && { all }) };
  }
  return Object.keys(out).length ? out : null;
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

/**
 * Where a program that pauses per part ("Take out …": freeing skin parts, tab removal per part) is, from FluidNC's SD
 * percent: the part being cut (0-based), and whether it's paused for that part to be taken out (nothing read past the
 * pause yet).
 */
export function takeOutAt(gcode: string, percent: number): { part: number; paused: boolean } {
  const read = (percent / 100) * new TextEncoder().encode(gcode).length;
  let n = 0,
    paused = false,
    offset = 0;
  for (const line of gcode.split('\n')) {
    offset += new TextEncoder().encode(line).length + 1;
    if (offset > read + 2) break;
    if (line.startsWith('M0 (MSG Take out ')) {
      n++;
      paused = true;
    } else if (/^G[0-3]\b/.test(line)) paused = false;
  }
  return paused ? { part: n - 1, paused } : { part: n, paused };
}

/** Which side of its board an entry's program is for: side B once the board is turned over. */
export const entrySide = (e: QueueEntry): 'a' | 'b' => (rotationKey(e).endsWith(':b') ? 'b' : 'a');

/**
 * What the top view shows of an entry's board besides its outline: which board and side, and on side A its screws or
 * clamps (and the ones the bit would hit), with the program's path to check a dragged one against.
 */
export function entryHolds(
  e: QueueEntry
): Pick<BoardOverlay, 'boardId' | 'side' | 'holds' | 'holdLike' | 'holdsOn' | 'holdClash' | 'bit' | 'path' | 'stockTop'> {
  const side = entrySide(e);
  const base = { boardId: e.board.board.id, side };
  const holds = e.board.request?.holdPoints;
  if (side === 'b' || !holds) return base;
  // A hold added here is like the others, or a clamp.
  const { clamp } = useHoldHardware.getState().hardware;
  return {
    ...base,
    holds,
    holdLike: holds.at(-1) ?? { kind: 'clamp', d: clamp.d, w: clamp.w, height: clamp.height },
    holdsOn: { w: e.board.nest.board.w, h: e.board.nest.board.h },
    ...(e.plan && {
      holdClash: e.plan.holdClash,
      bit: entryProgram(e)?.diameter ?? e.plan.bits[0],
      path: e.plan.path,
      stockTop: e.plan.size[2],
    }),
  };
}

/** "Board A · T2 ⌀6", "Board B · ⌀3.175", "Board A · remove tabs". */
export function entryTitle(e: QueueEntry) {
  const board = `Board ${e.board.board.name}`;
  if (!e.plan) return e.kind === 'error' ? `${board} · can’t be cut` : `${board} · being planned`;
  if (e.kind === 'tabs') return `${board} · remove tabs`;
  if (e.kind === 'flip') return `${board} · turn over`;
  if (e.kind === 'free') return `${board} · ${e.board.request.holdDown === 'fixture-tape' ? 'cut free' : 'free parts'}`;
  const p = e.plan.programs[e.program];
  const side = e.sideB ? ' side B' : '';
  const number = e.plan.programs.filter(program => program.tool === p.tool).length > 1 ? `P${e.program + 1} ` : '';
  return e.plan.programs.length > 1 ? `${board}${side} · ${number}T${p.tool} ⌀${p.diameter}` : `${board}${side} · ⌀${p.diameter}`;
}
