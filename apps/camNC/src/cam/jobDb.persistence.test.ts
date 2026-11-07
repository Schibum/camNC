import { addCircle, createPlateDocument } from '@wbcnc/cad';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setDemoModeForTest } from '@/lib/demo/demo-mode';
import { saveDesignDraft } from './cadDesign';
import {
  createDesignJob,
  createJob,
  deleteJob,
  getJob,
  getModelBytes,
  listJobs,
  replaceModel,
  saveJob,
  updateJobForModel,
  type CamJobV1,
} from './jobDb';

const context = vi.hoisted(() => ({ rehearsal: null as string | null }));
vi.mock('@/lib/demo/demo-mode', async original => ({
  ...(await original<typeof import('@/lib/demo/demo-mode')>()),
  getRehearsalId: () => context.rehearsal,
}));

afterEach(() => {
  setDemoModeForTest(false);
  context.rehearsal = null;
  vi.restoreAllMocks();
});

/** A separate connection can only read committed browser storage, never a module's cache. */
async function readCommitted(demo: boolean, id: string) {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const opening = indexedDB.open(demo ? 'camnc-cam-demo' : 'camnc-cam', 1);
    opening.onsuccess = () => resolve(opening.result);
    opening.onerror = () => reject(opening.error);
  });
  try {
    return await new Promise<{ job: CamJobV1 | undefined; bytes: ArrayBuffer | undefined }>((resolve, reject) => {
      const transaction = db.transaction(['jobs', 'models']);
      const job = transaction.objectStore('jobs').get(id) as IDBRequest<CamJobV1 | undefined>;
      const bytes = transaction.objectStore('models').get(id) as IDBRequest<ArrayBuffer | undefined>;
      transaction.oncomplete = () => resolve({ job: job.result, bytes: bytes.result });
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally {
    db.close();
  }
}

describe.each([false, true])('committed CAM document storage (demo: %s)', demo => {
  it('persists imported model CRUD atomically through the public job functions', async () => {
    setDemoModeForTest(demo);
    const job = await createJob(new File(['original bytes'], 'persistent.step'));
    const first = await readCommitted(demo, job.id);
    expect(first.job).toEqual(job);
    expect(new TextDecoder().decode(first.bytes)).toBe('original bytes');
    expect((await listJobs()).some(saved => saved.id === job.id)).toBe(true);

    const edited = await saveJob({ ...job, name: 'Renamed document' }, job);
    const updated = await updateJobForModel(edited, current => ({ ...current, nestObjective: 'wood' }));
    expect(updated?.name).toBe('Renamed document');
    const replaced = await replaceModel(updated!, new File(['new bytes'], 'persistent.stl'));
    expect((await readCommitted(demo, job.id)).job).toEqual(replaced);
    expect(new TextDecoder().decode((await readCommitted(demo, job.id)).bytes)).toBe('new bytes');

    // Callers cannot mutate a stored record or model by retaining a returned reference.
    const bytes = (await getModelBytes(job.id))!;
    bytes[0] = 0;
    const returned = (await getJob(job.id))!;
    returned.name = 'Unsaved change';
    expect((await getJob(job.id))?.name).toBe('Renamed document');
    expect(new TextDecoder().decode((await getModelBytes(job.id))!)).toBe('new bytes');

    await deleteJob(job.id);
    expect(await getJob(job.id)).toBeNull();
    expect(await getModelBytes(job.id)).toBeNull();
    expect(await readCommitted(demo, job.id)).toEqual({ job: undefined, bytes: undefined });
  });

  it('retains accepted source and a newer draft in browser storage independently', async () => {
    setDemoModeForTest(demo);
    const empty = await createDesignJob('Persistent native design');
    const accepted = { ...createPlateDocument(), id: empty.design!.draft.id };
    const job = await saveJob({
      ...empty,
      design: { draft: accepted, accepted, acceptedRevision: 1, partRevisions: { [accepted.parts[0]!.id]: 1 } },
    });
    const draft = structuredClone(accepted);
    draft.parts[0]!.sketch = addCircle(draft.parts[0]!.sketch, { x: 40, y: 40, radius: 10 });
    draft.revision++;
    const saved = await saveDesignDraft(job, draft);
    const committed = (await readCommitted(demo, job.id)).job!;
    expect(committed.design?.draft).toEqual(draft);
    expect(committed.design?.accepted).toEqual(accepted);
    expect(committed.design?.acceptedRevision).toBe(1);
    expect(await getJob(job.id)).toEqual(saved);
    expect(await getModelBytes(job.id)).toBeNull();
  });
});

it('isolates demo records and bytes even when a normal project has the same id', async () => {
  const normal = await createJob(new File(['physical source'], 'physical.step'));
  const before = await readCommitted(false, normal.id);
  setDemoModeForTest(true);
  expect(await getJob(normal.id)).toBeNull();
  expect(await getModelBytes(normal.id)).toBeNull();
  const demo = await saveJob({ ...normal, name: 'Simulated copy' });
  await replaceModel(demo, new File(['simulated source'], 'simulation.stl'));
  expect((await listJobs()).some(job => job.name === normal.name)).toBe(false);
  expect((await getJob(normal.id))?.name).toBe('Simulated copy');
  expect(new TextDecoder().decode((await getModelBytes(normal.id))!)).toBe('simulated source');
  expect(await readCommitted(false, normal.id)).toEqual(before);
  await deleteJob(normal.id);
  expect(await readCommitted(false, normal.id)).toEqual(before);
  setDemoModeForTest(false);
  expect(await getJob(normal.id)).toEqual(normal);
  expect(new TextDecoder().decode((await getModelBytes(normal.id))!)).toBe('physical source');
});

it('keeps rehearsal copies ephemeral and invisible to both persistent databases', async () => {
  const normal = await createJob(new File(['normal'], 'normal.step'));
  setDemoModeForTest(true);
  const demo = await createJob(new File(['demo'], 'demo.step'));
  context.rehearsal = crypto.randomUUID();
  expect(await getJob(normal.id)).toBeNull();
  expect(await getJob(demo.id)).toBeNull();
  const rehearsal = await createJob(new File(['rehearsal'], 'temporary.step'));
  const edited = await saveJob({ ...rehearsal, name: 'Rehearsal edit' }, rehearsal);
  await updateJobForModel(edited, current => ({ ...current, nestObjective: 'wood' }));
  await replaceModel(edited, new File(['temporary edit'], 'temporary.stl'));
  expect((await getJob(rehearsal.id))?.name).toBe('Rehearsal edit');
  expect(new TextDecoder().decode((await getModelBytes(rehearsal.id))!)).toBe('temporary edit');
  expect((await listJobs()).some(job => job.id === rehearsal.id)).toBe(true);
  expect(await readCommitted(true, rehearsal.id)).toEqual({ job: undefined, bytes: undefined });
  expect(await readCommitted(false, rehearsal.id)).toEqual({ job: undefined, bytes: undefined });
  await deleteJob(rehearsal.id);
  expect(await getJob(rehearsal.id)).toBeNull();
  expect(await getModelBytes(rehearsal.id)).toBeNull();
  context.rehearsal = null;
  expect(await getJob(demo.id)).toEqual(demo);
  setDemoModeForTest(false);
  expect(await getJob(normal.id)).toEqual(normal);
});

function deferredFile(name: string, text: string) {
  const file = new File([text], name);
  let release!: () => void;
  let reading!: () => void;
  const started = new Promise<void>(resolve => (reading = resolve));
  vi.spyOn(file, 'arrayBuffer').mockImplementation(
    () =>
      new Promise<ArrayBuffer>(resolve => {
        release = () => resolve(new TextEncoder().encode(text).buffer as ArrayBuffer);
        reading();
      })
  );
  return { file, started, release: () => release() };
}

describe.each([false, true])('storage context captured before awaits (starts in demo: %s)', demo => {
  it('keeps a new imported project in its starting namespace when mode changes during file reading', async () => {
    setDemoModeForTest(demo);
    const deferred = deferredFile('slow-import.step', 'belongs to starting context');
    const creating = createJob(deferred.file);
    await deferred.started;
    setDemoModeForTest(!demo);
    deferred.release();
    const job = await creating;
    const original = await readCommitted(demo, job.id);
    expect(original.job).toEqual(job);
    expect(new TextDecoder().decode(original.bytes)).toBe('belongs to starting context');
    expect(await readCommitted(!demo, job.id)).toEqual({ job: undefined, bytes: undefined });
    expect(await getJob(job.id)).toBeNull();
  });

  it('replaces only the starting namespace when both databases contain the same project id', async () => {
    setDemoModeForTest(false);
    const normal = await createJob(new File(['normal original'], 'normal.step'));
    setDemoModeForTest(true);
    const copy = await saveJob({ ...normal, name: 'Demo with the same id' });
    const simulated = await replaceModel(copy, new File(['demo original'], 'demo.step'));
    const untouched = await readCommitted(!demo, normal.id);
    setDemoModeForTest(demo);
    const deferred = deferredFile('slow-replacement.stl', demo ? 'demo replacement' : 'normal replacement');
    const replacing = replaceModel(demo ? simulated : normal, deferred.file);
    await deferred.started;
    setDemoModeForTest(!demo);
    deferred.release();
    const replaced = await replacing;
    const original = await readCommitted(demo, normal.id);
    expect(original.job).toEqual(replaced);
    expect(new TextDecoder().decode(original.bytes)).toBe(demo ? 'demo replacement' : 'normal replacement');
    expect(await readCommitted(!demo, normal.id)).toEqual(untouched);
    expect(await getJob(normal.id)).toEqual(untouched.job);
  });

  it('keeps native design naming and saving in the starting namespace while its job listing is pending', async () => {
    setDemoModeForTest(demo);
    const title = `Native context ${crypto.randomUUID()}`;
    await createDesignJob(title);
    const nativeGetAll = IDBObjectStore.prototype.getAll;
    let switched = false;
    vi.spyOn(IDBObjectStore.prototype, 'getAll').mockImplementationOnce(function (
      this: IDBObjectStore,
      ...args: Parameters<IDBObjectStore['getAll']>
    ) {
      // This is still a real asynchronous IndexedDB request. Switch before it delivers its result.
      const request = nativeGetAll.apply(this, args);
      setDemoModeForTest(!demo);
      switched = true;
      return request;
    });
    const job = await createDesignJob(title);
    expect(switched).toBe(true);
    expect(job.name).toBe(`${title} (2)`);
    expect((await readCommitted(demo, job.id)).job).toEqual(job);
    expect(await readCommitted(!demo, job.id)).toEqual({ job: undefined, bytes: undefined });
    expect(await getJob(job.id)).toBeNull();
  });
});
