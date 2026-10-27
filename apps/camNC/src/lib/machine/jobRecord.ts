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

export type RecoveryAction =
  /** Restore the job's toolpath and state (nothing else is loaded, or the same toolpath). */
  | { kind: 'restore' }
  /** The user loaded another toolpath meanwhile: ask before replacing it. */
  | { kind: 'ask' }
  /** A job runs, but it is not provably the recorded one: show its progress without the toolpath. */
  | { kind: 'mismatch'; reason: string }
  /** The recorded job is no longer running. */
  | { kind: 'ended' }
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
}): RecoveryAction {
  const { record, status, currentGcode, lastAlarm } = input;
  if (!record) return { kind: 'none' };
  const job = status.job;
  const running = !!job || status.state === 'Run' || status.state === 'Hold';
  if (!running) return { kind: 'ended' };
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

// --- storage: IndexedDB, since G-code can be several MB -------------------------------------------------------------

const kDbName = 'camnc-jobs';
const kStore = 'jobs';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(kDbName, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(kStore);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const request = fn(db.transaction(kStore, mode).objectStore(kStore));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

/** The last job started on `host`; a new one replaces it. */
export function saveJobRecord(record: JobRecord) {
  return withStore('readwrite', store => store.put(record, record.host)).then(() => {});
}

export function loadJobRecord(host: string): Promise<JobRecord | null> {
  return withStore<JobRecord | undefined>('readonly', store => store.get(host)).then(record => record ?? null);
}

export function clearJobRecord(host: string) {
  return withStore('readwrite', store => store.delete(host)).then(() => {});
}
