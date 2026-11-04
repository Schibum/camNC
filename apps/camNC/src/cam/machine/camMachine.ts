import { orderBoardQueue } from '@wbcnc/cam/board';
import { create } from 'zustand';
import { combine, persist } from 'zustand/middleware';
import type { TabStop } from '@wbcnc/cam';
import { boardBlock, type BlockContext } from '../boardBlock';
import type { PlanResult, ReleaseProgram } from '../camTypes';
import type { JobBoard } from '../useJobBoards';

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
}

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
      })
    ),
    {
      name: 'camnc-cam-machine',
      // Version 1: once per part became the default, with the hand off the part while tabs are cut. Browsers saved the old
      // default without anyone choosing it.
      version: 1,
      migrate: (saved, version) => (version < 1 ? { ...(saved as object), pauseEachTab: false } : saved) as never,
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

/** What comes after `current`: the next entry to cut, or an earlier one left out. */
export function nextEntry(queue: QueueEntry[], current: QueueEntry, done: string[]): QueueEntry | null {
  const i = queue.indexOf(current);
  const toCut = (e: QueueEntry) => e !== current && !done.includes(e.doneId);
  return queue.slice(i + 1).find(toCut) ?? queue.slice(0, i).find(toCut) ?? null;
}

/** Which rotation an entry's program lies at: side B has its own, from turning the board over on. */
export const rotationKey = (e: QueueEntry) =>
  e.sideB || e.kind === 'flip' || e.release?.turned ? `${e.board.board.id}:b` : e.board.board.id;

/** The angle of an entry's program: until side B is corrected it lies like side A. */
export const entryRotation = (e: QueueEntry, rotation: Record<string, number>) =>
  rotation[rotationKey(e)] ?? rotation[e.board.board.id] ?? 0;

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

/** "Board A · T2 ⌀6", "Board B · ⌀3.175", "Board A · remove tabs". */
export function entryTitle(e: QueueEntry) {
  const board = `Board ${e.board.board.name}`;
  if (!e.plan) return e.kind === 'error' ? `${board} · can’t be cut` : `${board} · being planned`;
  if (e.kind === 'tabs') return `${board} · remove tabs`;
  if (e.kind === 'flip') return `${board} · turn over`;
  if (e.kind === 'free') return `${board} · ${e.board.request.holdDown === 'fixture-tape' ? 'cut free' : 'free parts'}`;
  const p = e.plan.programs[e.program];
  const side = e.sideB ? ' side B' : '';
  return e.plan.programs.length > 1 ? `${board}${side} · T${p.tool} ⌀${p.diameter}` : `${board}${side} · ⌀${p.diameter}`;
}
