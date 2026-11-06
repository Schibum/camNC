import { isDemoMode } from '@/lib/demo/demo-mode';
import { rebaseJob } from './rebaseJob';
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
  /** Where a new job started; it remains a normal editable document. */
  origin?: { kind: 'sample'; id: string; revision: number };
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

const demoJobs = new Map<string, CamJobV1>();
const demoModels = new Map<string, Uint8Array>();

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

export type NewJobDefaults = Pick<
  Partial<CamJobV1>,
  'name' | 'origin' | 'plan' | 'boards' | 'stock' | 'parts' | 'partsFrom' | 'modelRevision' | 'nestObjective'
>;

export async function createJob(file: File, defaults: NewJobDefaults = {}): Promise<CamJobV1> {
  const now = Date.now();
  const taken = (await listJobs()).map(j => j.name);
  const job: CamJobV1 = {
    ...structuredClone(defaults),
    v: 1,
    id: crypto.randomUUID(),
    name: uniqueJobName(defaults.name ?? file.name.replace(kModelFile, ''), taken),
    fileName: file.name,
    createdAt: now,
    updatedAt: now,
    parts: structuredClone(defaults.parts ?? []),
  };
  const bytes = await file.arrayBuffer();
  if (isDemoMode()) {
    demoJobs.set(job.id, structuredClone(job));
    demoModels.set(job.id, new Uint8Array(bytes));
    return job;
  }
  await tx([kJobs, kModels], 'readwrite', t => {
    t.objectStore(kJobs).put(job);
    t.objectStore(kModels).put(bytes, job.id);
  });
  return job;
}

export async function listJobs(): Promise<CamJobV1[]> {
  if (isDemoMode()) return structuredClone([...demoJobs.values()]).sort((a, b) => b.updatedAt - a.updatedAt);
  const db = await openDb();
  const jobs = await request(db.transaction(kJobs).objectStore(kJobs).getAll() as IDBRequest<CamJobV1[]>);
  return jobs.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getJob(id: string): Promise<CamJobV1 | null> {
  if (isDemoMode()) return structuredClone(demoJobs.get(id) ?? null);
  const db = await openDb();
  return (await request(db.transaction(kJobs).objectStore(kJobs).get(id) as IDBRequest<CamJobV1 | undefined>)) ?? null;
}

export async function getModelBytes(id: string): Promise<Uint8Array | null> {
  if (isDemoMode()) return demoModels.get(id)?.slice() ?? null;
  const db = await openDb();
  const buf = await request(db.transaction(kModels).objectStore(kModels).get(id) as IDBRequest<ArrayBuffer | undefined>);
  return buf ? new Uint8Array(buf) : null;
}

/** Save a document, or rebase an edit from `base` within the guarded transaction. */
export async function saveJob(job: CamJobV1, base?: CamJobV1): Promise<CamJobV1> {
  if (base) {
    const saved = await updateJobForModel(base, current => rebaseJob(base, job, current));
    if (!saved) throw new Error('This job or its model changed. Open it again before editing.');
    return saved;
  }
  const saved = { ...job, updatedAt: Date.now() };
  if (isDemoMode()) {
    demoJobs.set(job.id, structuredClone(saved));
    return saved;
  }
  await tx([kJobs], 'readwrite', t => t.objectStore(kJobs).put(saved));
  return saved;
}

/** One version of a job's model: what its parts and programs are computed from. */
export const modelKey = (job: CamJobV1) => `${job.id}:${job.fileName}:${job.modelRevision ?? 0}`;

/**
 * Commit an update only while its model still belongs to an existing job. Reading and writing in one transaction
 * keeps a late worker response from restoring a deleted job or putting old parts onto a replaced model.
 * `update` runs synchronously against the current job; null means there is nothing to save.
 */
export async function updateJobForModel(source: CamJobV1, update: (current: CamJobV1) => CamJobV1 | null): Promise<CamJobV1 | null> {
  const apply = (current: CamJobV1 | undefined) => {
    if (!current || modelKey(current) !== modelKey(source)) return null;
    const next = update(current);
    return next && { ...next, updatedAt: Date.now() };
  };
  if (isDemoMode()) {
    const current = demoJobs.get(source.id);
    const saved = apply(current && structuredClone(current));
    if (saved) demoJobs.set(source.id, structuredClone(saved));
    return saved;
  }
  let saved: CamJobV1 | null = null;
  await tx([kJobs], 'readwrite', t => {
    const store = t.objectStore(kJobs);
    const req = store.get(source.id) as IDBRequest<CamJobV1 | undefined>;
    req.onsuccess = () => {
      saved = apply(req.result);
      if (saved) store.put(saved);
    };
  });
  return saved;
}

/** Swap the model file of a job; parts are re-derived on the next import, found again by what they are (`partMatch`). */
export async function replaceModel(job: CamJobV1, file: File): Promise<CamJobV1> {
  const bytes = await file.arrayBuffer();
  // Reading a file or picking it in another tab can outlive edits, another replacement, or deletion. Derive the
  // revision from the stored job in the same transaction as the bytes, so every committed model has its own key.
  const replace = (current: CamJobV1 | undefined) => {
    if (!current) return null;
    const saved = { ...current, fileName: file.name, modelRevision: (current.modelRevision ?? 0) + 1, updatedAt: Date.now() };
    delete saved.readError;
    return saved;
  };
  const missing = () => new Error('This job no longer exists. Open another job before replacing its model.');
  if (isDemoMode()) {
    const saved = replace(demoJobs.get(job.id));
    if (!saved) throw missing();
    demoJobs.set(job.id, structuredClone(saved));
    demoModels.set(job.id, new Uint8Array(bytes));
    return saved;
  }
  let saved: CamJobV1 | null = null;
  await tx([kJobs, kModels], 'readwrite', t => {
    const store = t.objectStore(kJobs);
    const req = store.get(job.id) as IDBRequest<CamJobV1 | undefined>;
    req.onsuccess = () => {
      saved = replace(req.result);
      if (!saved) return;
      store.put(saved);
      t.objectStore(kModels).put(bytes, job.id);
    };
  });
  if (!saved) throw missing();
  return saved;
}

export async function deleteJob(id: string): Promise<void> {
  if (isDemoMode()) {
    demoJobs.delete(id);
    demoModels.delete(id);
    return;
  }
  await tx([kJobs, kModels], 'readwrite', t => {
    t.objectStore(kJobs).delete(id);
    t.objectStore(kModels).delete(id);
  });
}
