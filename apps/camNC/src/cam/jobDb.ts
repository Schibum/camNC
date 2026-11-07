import { getRehearsalId, isDemoMode } from '@/lib/demo/demo-mode';
import { rebaseJob } from './rebaseJob';
import type { BoardV1, StockBoardV1 } from './boards';
import type { NestObjective } from './autoNest';
import type { PartPrint } from './partMatch';
import type { PlanSettingsV1 } from './planSettings';
import { createCadDocument, createCadPart, type CadDocument } from '@wbcnc/cad';

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
  /** Native sketch drafts autosave independently of the geometry accepted by CAM. */
  design?: {
    draft: CadDocument;
    accepted?: CadDocument;
    acceptedRevision: number;
    /** Geometry revisions by permanent part ID, used to regenerate only affected boards. */
    partRevisions: Record<string, number>;
    /** Evaluated geometry content, independent of monotonic revision numbers and source annotations. */
    partGeometryKeys?: Record<string, string>;
    /** Removed hole targets retain their choices for Undo, but never apply to another hole. */
    holeChoiceIssues?: import('./holeChoices').MissingHoleChoice[];
  };
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
const kDemoDbName = 'camnc-cam-demo';
const kJobs = 'jobs';
const kModels = 'models';

// Rehearsals deliberately restart from their handoff snapshot on reload. Ordinary demo
// designs use their own persistent database, never the visitor's saved CAM projects.
const rehearsalJobs = new Map<string, CamJobV1>();
const rehearsalModels = new Map<string, Uint8Array>();
type StorageContext = 'normal' | 'demo' | 'rehearsal';
// Capture once at public entry: file reads and IndexedDB requests may outlive leaving demo mode.
const captureStorageContext = (): StorageContext => (!isDemoMode() ? 'normal' : getRehearsalId() ? 'rehearsal' : 'demo');

const databases = new Map<string, Promise<IDBDatabase>>();

function openDb(context: Exclude<StorageContext, 'rehearsal'>): Promise<IDBDatabase> {
  const name = context === 'demo' ? kDemoDbName : kDbName;
  const existing = databases.get(name);
  if (existing) return existing;
  const opening = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(name, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      db.createObjectStore(kJobs, { keyPath: 'id' });
      // Model bytes by job id, kept apart so listing jobs doesn't load them.
      db.createObjectStore(kModels);
    };
    req.onsuccess = () => {
      const db = req.result;
      const invalidate = () => {
        if (databases.get(name) === opening) databases.delete(name);
      };
      db.onclose = invalidate;
      db.onversionchange = () => {
        db.close();
        invalidate();
      };
      resolve(db);
    };
    req.onerror = () => {
      if (databases.get(name) === opening) databases.delete(name);
      reject(req.error);
    };
  });
  databases.set(name, opening);
  return opening;
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx(
  context: Exclude<StorageContext, 'rehearsal'>,
  stores: string[],
  mode: IDBTransactionMode,
  fn: (t: IDBTransaction) => void
): Promise<void> {
  const db = await openDb(context);
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
  const context = captureStorageContext();
  const now = Date.now();
  const taken = (await listJobsIn(context)).map(j => j.name);
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
  if (context === 'rehearsal') {
    rehearsalJobs.set(job.id, structuredClone(job));
    rehearsalModels.set(job.id, new Uint8Array(bytes));
    return job;
  }
  await tx(context, [kJobs, kModels], 'readwrite', t => {
    t.objectStore(kJobs).put(job);
    t.objectStore(kModels).put(bytes, job.id);
  });
  return job;
}

/** Start a native flat-part design without an intermediate model file. */
export async function createDesignJob(name = 'Untitled design'): Promise<CamJobV1> {
  const context = captureStorageContext();
  const now = Date.now();
  const title = uniqueJobName(
    name,
    (await listJobsIn(context)).map(j => j.name)
  );
  const draft = createCadDocument(title);
  draft.parts.push(createCadPart('Part 1'));
  return saveJobIn(context, {
    v: 1,
    id: crypto.randomUUID(),
    name: title,
    fileName: title,
    createdAt: now,
    updatedAt: now,
    parts: [],
    design: { draft, acceptedRevision: 0, partRevisions: {} },
  });
}

export function listJobs(): Promise<CamJobV1[]> {
  return listJobsIn(captureStorageContext());
}

async function listJobsIn(context: StorageContext): Promise<CamJobV1[]> {
  if (context === 'rehearsal') return structuredClone([...rehearsalJobs.values()]).sort((a, b) => b.updatedAt - a.updatedAt);
  const db = await openDb(context);
  const jobs = await request(db.transaction(kJobs).objectStore(kJobs).getAll() as IDBRequest<CamJobV1[]>);
  return jobs.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getJob(id: string): Promise<CamJobV1 | null> {
  const context = captureStorageContext();
  if (context === 'rehearsal') return structuredClone(rehearsalJobs.get(id) ?? null);
  const db = await openDb(context);
  return (await request(db.transaction(kJobs).objectStore(kJobs).get(id) as IDBRequest<CamJobV1 | undefined>)) ?? null;
}

export async function getModelBytes(id: string): Promise<Uint8Array | null> {
  const context = captureStorageContext();
  if (context === 'rehearsal') return rehearsalModels.get(id)?.slice() ?? null;
  const db = await openDb(context);
  const buf = await request(db.transaction(kModels).objectStore(kModels).get(id) as IDBRequest<ArrayBuffer | undefined>);
  return buf ? new Uint8Array(buf) : null;
}

/** Save a document, or rebase an edit from `base` within the guarded transaction. */
export function saveJob(job: CamJobV1, base?: CamJobV1): Promise<CamJobV1> {
  return saveJobIn(captureStorageContext(), job, base);
}

async function saveJobIn(context: StorageContext, job: CamJobV1, base?: CamJobV1): Promise<CamJobV1> {
  if (base) {
    const saved = await updateJobForModelIn(context, base, current => rebaseJob(base, job, current));
    if (!saved) throw new Error('This job or its model changed. Open it again before editing.');
    return saved;
  }
  const saved = { ...job, updatedAt: Date.now() };
  if (context === 'rehearsal') {
    rehearsalJobs.set(job.id, structuredClone(saved));
    return saved;
  }
  await tx(context, [kJobs], 'readwrite', t => t.objectStore(kJobs).put(saved));
  return saved;
}

/** One version of a job's model: what its parts and programs are computed from. */
export const modelKey = (job: CamJobV1) =>
  job.design ? `${job.id}:cad:${job.design.acceptedRevision}` : `${job.id}:${job.fileName}:${job.modelRevision ?? 0}`;

/**
 * Commit an update only while its model still belongs to an existing job. Reading and writing in one transaction
 * keeps a late worker response from restoring a deleted job or putting old parts onto a replaced model.
 * `update` runs synchronously against the current job; null means there is nothing to save.
 */
export function updateJobForModel(source: CamJobV1, update: (current: CamJobV1) => CamJobV1 | null): Promise<CamJobV1 | null> {
  return updateJobForModelIn(captureStorageContext(), source, update);
}

async function updateJobForModelIn(
  context: StorageContext,
  source: CamJobV1,
  update: (current: CamJobV1) => CamJobV1 | null
): Promise<CamJobV1 | null> {
  const apply = (current: CamJobV1 | undefined) => {
    if (!current || modelKey(current) !== modelKey(source)) return null;
    const next = update(current);
    return next && { ...next, updatedAt: Date.now() };
  };
  if (context === 'rehearsal') {
    const current = rehearsalJobs.get(source.id);
    const saved = apply(current && structuredClone(current));
    if (saved) rehearsalJobs.set(source.id, structuredClone(saved));
    return saved;
  }
  let saved: CamJobV1 | null = null;
  await tx(context, [kJobs], 'readwrite', t => {
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
  const context = captureStorageContext();
  if (job.design) throw new Error('Open a model as a new job. Native designs are edited in Design.');
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
  if (context === 'rehearsal') {
    const saved = replace(rehearsalJobs.get(job.id));
    if (!saved) throw missing();
    rehearsalJobs.set(job.id, structuredClone(saved));
    rehearsalModels.set(job.id, new Uint8Array(bytes));
    return saved;
  }
  let saved: CamJobV1 | null = null;
  await tx(context, [kJobs, kModels], 'readwrite', t => {
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
  const context = captureStorageContext();
  if (context === 'rehearsal') {
    rehearsalJobs.delete(id);
    rehearsalModels.delete(id);
    return;
  }
  await tx(context, [kJobs, kModels], 'readwrite', t => {
    t.objectStore(kJobs).delete(id);
    t.objectStore(kModels).delete(id);
  });
}
