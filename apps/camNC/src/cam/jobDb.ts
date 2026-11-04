import type { BoardV1, StockBoardV1 } from './boards';
import type { NestObjective } from './autoNest';
import type { PartPrint } from './partMatch';
import type { PlanSettingsV1 } from './planSettings';

/**
 * CAM jobs live in IndexedDB, not in the persisted zustand store: model files are megabytes, and jobs are documents
 * the user opens, not app settings.
 */

export interface CamJobPartV1 {
  id: string;
  name: string;
  quantity: number;
  /** False for 3D-printed or bought parts: they stay out of boards. */
  milled: boolean;
}

export interface CamJobV1 {
  v: 1;
  id: string;
  name: string;
  fileName: string;
  /** Goes up with every replaced model file: a file of the same name can hold another model. */
  modelRevision?: number;
  createdAt: number;
  updatedAt: number;
  /** Empty until the model has been imported once. */
  parts: CamJobPartV1[];
  /** Why the model file could not be read, for people (see `modelReadError`); unset once it has been read. */
  readError?: string;
  /** Which revision of the model `parts` come from, and what each part was: to find them again in a replaced model. */
  partsFrom?: { revision: number; prints: Record<string, PartPrint> };
  /** What a replaced model didn't let `parts` keep, for people, until dismissed (see `replaceWarning`). */
  replaceWarning?: string;
  /** Plan step choices (bit, material, ...); defaults until changed. */
  plan?: PlanSettingsV1;
  /** Boards the parts are nested on; derived per thickness until the user changes them. */
  boards?: BoardV1[];
  /** Board sizes the user has in the workshop, for "Auto-fill from stock". */
  stock?: StockBoardV1[];
  /** What "Auto-fill from stock" optimizes first: fewest boards (default) or least wood. */
  nestObjective?: NestObjective;
}

const kDbName = 'camnc-cam';
const kJobs = 'jobs';
const kModels = 'models';

let dbPromise: Promise<IDBDatabase> | undefined;

function openDb(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(kDbName, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      db.createObjectStore(kJobs, { keyPath: 'id' });
      // Model bytes by job id, kept apart so listing jobs doesn't load them.
      db.createObjectStore(kModels);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx(stores: string[], mode: IDBTransactionMode, fn: (t: IDBTransaction) => void): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction(stores, mode);
    fn(t);
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

export const kModelFile = /\.(step|stp|stl)$/i;

/** `name`, or "name (2)", "name (3)", … if a job of that name exists: opening the same file twice. */
export function uniqueJobName(name: string, taken: string[]): string {
  const used = new Set(taken);
  if (!used.has(name)) return name;
  let k = 2;
  while (used.has(`${name} (${k})`)) k++;
  return `${name} (${k})`;
}

export async function createJob(file: File): Promise<CamJobV1> {
  const now = Date.now();
  const taken = (await listJobs()).map(j => j.name);
  const job: CamJobV1 = {
    v: 1,
    id: crypto.randomUUID(),
    name: uniqueJobName(file.name.replace(kModelFile, ''), taken),
    fileName: file.name,
    createdAt: now,
    updatedAt: now,
    parts: [],
  };
  const bytes = await file.arrayBuffer();
  await tx([kJobs, kModels], 'readwrite', t => {
    t.objectStore(kJobs).put(job);
    t.objectStore(kModels).put(bytes, job.id);
  });
  return job;
}

export async function listJobs(): Promise<CamJobV1[]> {
  const db = await openDb();
  const jobs = await request(db.transaction(kJobs).objectStore(kJobs).getAll() as IDBRequest<CamJobV1[]>);
  return jobs.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getJob(id: string): Promise<CamJobV1 | null> {
  const db = await openDb();
  return (await request(db.transaction(kJobs).objectStore(kJobs).get(id) as IDBRequest<CamJobV1 | undefined>)) ?? null;
}

export async function getModelBytes(id: string): Promise<Uint8Array | null> {
  const db = await openDb();
  const buf = await request(db.transaction(kModels).objectStore(kModels).get(id) as IDBRequest<ArrayBuffer | undefined>);
  return buf ? new Uint8Array(buf) : null;
}

export async function saveJob(job: CamJobV1): Promise<CamJobV1> {
  const saved = { ...job, updatedAt: Date.now() };
  await tx([kJobs], 'readwrite', t => t.objectStore(kJobs).put(saved));
  return saved;
}

/** Swap the model file of a job; parts are re-derived on the next import, found again by what they are (`partMatch`). */
export async function replaceModel(job: CamJobV1, file: File): Promise<CamJobV1> {
  const saved = { ...job, fileName: file.name, modelRevision: (job.modelRevision ?? 0) + 1, updatedAt: Date.now() };
  delete saved.readError;
  const bytes = await file.arrayBuffer();
  await tx([kJobs, kModels], 'readwrite', t => {
    t.objectStore(kJobs).put(saved);
    t.objectStore(kModels).put(bytes, job.id);
  });
  return saved;
}

export async function deleteJob(id: string): Promise<void> {
  await tx([kJobs, kModels], 'readwrite', t => {
    t.objectStore(kJobs).delete(id);
    t.objectStore(kModels).delete(id);
  });
}
