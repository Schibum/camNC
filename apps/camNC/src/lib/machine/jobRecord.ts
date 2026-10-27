import type { MachineStatus, Position } from '@wbcnc/fluidnc';
import type { AlarmRecord } from './alarms';

/** What camNC knew when it started a job, so that a reload during the job can show it again. */
export interface JobRecord {
  host: string;
  /** SD file the job runs from (`/sd/<name>` in the status). */
  sdFile: string;
  gcode: string;
  toolpathName: string | null;
  toolpathOffset: { x: number; y: number; z: number };
  stockHeight: number;
  toolDiameter: number;
  /** Work offset (WCO) at the start, in machine coordinates. */
  wco: Position;
  startedAt: number;
  homed: boolean;
  zZeroedAt: number | null;
}

/** Where a job was, saved every few seconds while it runs, to resume it after an interruption (see resume.ts). */
export interface JobProgressLog {
  host: string;
  /** The SD file of the status report, e.g. `/sd/camnc.gcode`. */
  file: string;
  /** SD percent and machine position from the same status report. */
  percent: number;
  mpos: Position;
  wco: Position;
  at: number;
}

/** Below this SD percent a job that is gone did not finish (FluidNC reports 100 once the file is read). */
export const kFinishedPercent = 99.9;

export type RecoveryAction =
  /** Restore the job's toolpath and state (nothing else is loaded, or the same toolpath). */
  | { kind: 'restore' }
  /** The user loaded another toolpath meanwhile: ask before replacing it. */
  | { kind: 'ask' }
  /** A job runs, but it is not provably the recorded one: show its progress without the toolpath. */
  | { kind: 'mismatch'; reason: string }
  /** The recorded job is no longer running, and was last seen near its end. */
  | { kind: 'ended' }
  /** The recorded job is no longer running, and was last seen part way through: offer to resume it. */
  | { kind: 'interrupted'; progress: JobProgressLog }
  | { kind: 'none' };

/** Work offsets closer than this (mm) count as unchanged. */
const kWcoTolerance = 0.01;

const sameWco = (a: Position, b: Position) =>
  Math.abs(a.x - b.x) <= kWcoTolerance && Math.abs(a.y - b.y) <= kWcoTolerance && Math.abs(a.z - b.z) <= kWcoTolerance;

/**
 * What to do with a recorded job once connected again. Only restores what can be checked: the same SD file is
 * running, the work offset is unchanged and no alarm was seen since the start.
 */
export function recoveryAction(input: {
  record: JobRecord | null;
  status: MachineStatus;
  currentGcode: string | null;
  lastAlarm: AlarmRecord | null;
  progress?: JobProgressLog | null;
}): RecoveryAction {
  const { record, status, currentGcode, lastAlarm, progress } = input;
  if (!record) return { kind: 'none' };
  const job = status.job;
  const running = !!job || status.state === 'Run' || status.state === 'Hold';
  if (!running) {
    const ours = progress && progress.file.endsWith(record.sdFile) && progress.at >= record.startedAt;
    return ours && progress.percent < kFinishedPercent ? { kind: 'interrupted', progress } : { kind: 'ended' };
  }
  if (!job) return { kind: 'none' };
  if (!job.file.endsWith(record.sdFile)) {
    return { kind: 'mismatch', reason: `The controller runs ${job.file}, not the job camNC started (${record.sdFile}).` };
  }
  if (!sameWco(status.wco, record.wco)) {
    return { kind: 'mismatch', reason: 'The work offset changed since camNC started this job, so its toolpath may not match.' };
  }
  if (lastAlarm && lastAlarm.at > record.startedAt) {
    return { kind: 'mismatch', reason: 'There was an alarm since camNC started this job, so its position may not match.' };
  }
  if (currentGcode && currentGcode !== record.gcode) return { kind: 'ask' };
  return { kind: 'restore' };
}

/**
 * A job seen ending while connected: did it finish? A Stop or an alarm part way through leave it resumable. The SD
 * percent does not tell: FluidNC drops it when the file is read, before the last moves are done.
 */
export function jobEnding(input: {
  state: string;
  lastPercent: number | null;
  stopRequested: boolean;
  alarmSinceStart: boolean;
}): { finished: true } | { finished: false; reason: string } {
  const at = input.lastPercent !== null ? ` at ${input.lastPercent.toFixed(1)}%` : '';
  if (input.alarmSinceStart || input.state === 'Alarm')
    return { finished: false, reason: `The controller stopped the job with an alarm${at}.` };
  if (input.stopRequested) return { finished: false, reason: `You stopped the job${at}.` };
  return { finished: true };
}

// --- storage: IndexedDB, since G-code can be several MB -------------------------------------------------------------

const kDbName = 'camnc-jobs';
const kStore = 'jobs';
const kProgressStore = 'progress';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(kDbName, 2);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(kStore)) db.createObjectStore(kStore);
      if (!db.objectStoreNames.contains(kProgressStore)) db.createObjectStore(kProgressStore);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore<T>(name: string, mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const request = fn(db.transaction(name, mode).objectStore(name));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

/** The last job started on `host`; a new one replaces it. */
export function saveJobRecord(record: JobRecord) {
  return withStore(kStore, 'readwrite', store => store.put(record, record.host)).then(() => {});
}

export function loadJobRecord(host: string): Promise<JobRecord | null> {
  return withStore<JobRecord | undefined>(kStore, 'readonly', store => store.get(host)).then(record => record ?? null);
}

/** Forget the job and where it was. */
export async function clearJobRecord(host: string) {
  await withStore(kStore, 'readwrite', store => store.delete(host));
  await clearJobProgress(host);
}

/** Kept apart from the record, so that the G-code is not written again every few seconds. */
export function saveJobProgress(progress: JobProgressLog) {
  return withStore(kProgressStore, 'readwrite', store => store.put(progress, progress.host)).then(() => {});
}

export function loadJobProgress(host: string): Promise<JobProgressLog | null> {
  return withStore<JobProgressLog | undefined>(kProgressStore, 'readonly', store => store.get(host)).then(p => p ?? null);
}

export function clearJobProgress(host: string) {
  return withStore(kProgressStore, 'readwrite', store => store.delete(host)).then(() => {});
}
