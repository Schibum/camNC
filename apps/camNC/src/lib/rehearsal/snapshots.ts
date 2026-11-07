import { startOverBoard, type BoardV1 } from '@/cam/boards';
import type { CuttingData } from '@/cam/cuttingData';
import type { CamJobV1 } from '@/cam/jobDb';
import type { StoredBit } from '@/cam/toolLibrary';
import type { SpindleSwitch } from '@wbcnc/cam';

export const kRehearsalLifetime = 24 * 60 * 60 * 1000;
export interface RehearsalSnapshot {
  v: 1;
  id: string;
  expiresAt: number;
  sourceId: string;
  /** Board selected before the setup detour; the rehearsal still contains the full job. */
  boardId?: string;
  job: CamJobV1;
  model: Uint8Array;
  bits: StoredBit[];
  cutting: Record<string, Partial<CuttingData>>;
  pauseEachTab: boolean;
  spindle: SpindleSwitch;
}

/** A copy of the current layout, without any physical cut or placement history. No host or camera settings cross. */
export function makeSnapshot(
  job: CamJobV1,
  model: Uint8Array,
  boards: BoardV1[],
  settings: Pick<RehearsalSnapshot, 'bits' | 'cutting' | 'pauseEachTab' | 'spindle'>,
  now = Date.now()
): RehearsalSnapshot {
  return structuredClone({
    v: 1,
    id: crypto.randomUUID(),
    expiresAt: now + kRehearsalLifetime,
    sourceId: job.id,
    job: {
      ...job,
      boards: boards.map(board => {
        const copy = startOverBoard(board);
        delete copy.bed;
        return copy;
      }),
    },
    model,
    ...settings,
  });
}

/** One purpose-built handoff database; normal jobs and machine recovery never live here. */
async function withSnapshots<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('camnc-rehearsals', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('snapshots', { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction('snapshots', mode);
      const req = run(tx.objectStore('snapshots'));
      tx.oncomplete = () => resolve(req.result);
      tx.onabort = () => reject(tx.error ?? new Error('Rehearsal could not be saved.'));
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export async function saveSnapshot(snapshot: RehearsalSnapshot) {
  await withSnapshots('readwrite', store => store.put(snapshot));
}

export async function loadSnapshot(id: string, now = Date.now()): Promise<RehearsalSnapshot> {
  const s = await withSnapshots<RehearsalSnapshot | undefined>('readonly', store => store.get(id));
  if (
    !s ||
    s.v !== 1 ||
    s.id !== id ||
    !Number.isFinite(s.expiresAt) ||
    s.expiresAt <= now ||
    typeof s.sourceId !== 'string' ||
    !s.sourceId ||
    s.job?.v !== 1 ||
    typeof s.job.fileName !== 'string' ||
    !/\.(step|stp|stl)$/i.test(s.job.fileName) ||
    !(s.model instanceof Uint8Array) ||
    !s.model.length ||
    !Array.isArray(s.bits) ||
    !s.cutting ||
    !Array.isArray(s.job.boards)
  ) {
    throw new Error('This rehearsal has expired or is unavailable. Start a new one from your CAM plan.');
  }
  return s;
}

export async function deleteSnapshot(id: string) {
  await withSnapshots('readwrite', store => store.delete(id));
}

export async function cleanExpiredSnapshots(now = Date.now()) {
  const snapshots = await withSnapshots<RehearsalSnapshot[]>('readonly', store => store.getAll());
  await Promise.all(snapshots.filter(s => !Number.isFinite(s.expiresAt) || s.expiresAt <= now).map(s => deleteSnapshot(s.id)));
}

/** Always a local CAM route, even if stored metadata is malformed. */
export const returnToSource = (sourceId: string) => `/cam/${encodeURIComponent(sourceId)}/plan?rehearsed=1`;
