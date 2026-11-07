import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setDemoModeForTest } from '@/lib/demo/demo-mode';
import { createJob, deleteJob, getJob, getModelBytes, listJobs, saveJob } from './jobDb';

vi.mock('@/lib/demo/demo-mode', async original => ({
  ...(await original<typeof import('@/lib/demo/demo-mode')>()),
  getRehearsalId: () => null,
}));

let connections: IDBDatabase[] = [];

beforeEach(() => {
  connections = [];
  const nativeOpen = IDBFactory.prototype.open;
  vi.spyOn(IDBFactory.prototype, 'open').mockImplementation(function (this: IDBFactory, name: string, version?: number) {
    const request = nativeOpen.call(this, name, version);
    request.addEventListener('success', () => connections.push(request.result));
    return request;
  });
});

afterEach(() => {
  // Release real browser connections and the module's corresponding cached entries.
  for (const db of connections) {
    db.dispatchEvent(new Event('versionchange'));
    db.close();
  }
  setDemoModeForTest(false);
  vi.restoreAllMocks();
});

function opened(demo: boolean) {
  return connections.filter(db => db.name.endsWith(demo ? ':camnc-cam-demo' : ':camnc-cam'));
}

function closeUnexpectedly(db: IDBDatabase) {
  // close() creates a genuinely unusable connection. The browser normally sends this
  // notification only for abnormal closure, so dispatch that notification explicitly.
  db.close();
  db.dispatchEvent(new Event('close'));
}

describe.each([false, true])('unexpected IndexedDB close (demo: %s)', demo => {
  it('reopens only the closed namespace and preserves observable job/model CRUD', async () => {
    setDemoModeForTest(false);
    const normal = await createJob(new File(['normal durable bytes'], 'normal.step'));
    setDemoModeForTest(true);
    const simulated = await createJob(new File(['demo durable bytes'], 'demo.step'));
    const target = demo ? simulated : normal;
    const other = demo ? normal : simulated;
    const oldConnection = opened(demo).at(-1)!;
    closeUnexpectedly(oldConnection);

    setDemoModeForTest(!demo);
    expect(await getJob(other.id)).toEqual(other);
    expect(opened(!demo)).toHaveLength(1);

    setDemoModeForTest(demo);
    expect(await getJob(target.id)).toEqual(target);
    expect(new TextDecoder().decode((await getModelBytes(target.id))!)).toBe(demo ? 'demo durable bytes' : 'normal durable bytes');
    expect(opened(demo)).toHaveLength(2);
    const edited = await saveJob({ ...target, name: 'Reopened and edited' }, target);
    expect(await getJob(target.id)).toEqual(edited);
    expect((await listJobs()).some(job => job.id === target.id)).toBe(true);
    const created = await createJob(new File(['after close'], 'after-close.step'));
    expect(new TextDecoder().decode((await getModelBytes(created.id))!)).toBe('after close');
    await deleteJob(created.id);
    expect(await getJob(created.id)).toBeNull();
    expect(await getModelBytes(created.id)).toBeNull();

    // A late notification from the old connection must not evict its replacement.
    oldConnection.dispatchEvent(new Event('close'));
    oldConnection.dispatchEvent(new Event('versionchange'));
    expect(await getJob(target.id)).toEqual(edited);
    expect(opened(demo)).toHaveLength(2);
    setDemoModeForTest(!demo);
    expect(await getJob(other.id)).toEqual(other);
    expect(opened(!demo)).toHaveLength(1);
  });

  it('retains the captured namespace when closure and a mode change happen during a file read', async () => {
    setDemoModeForTest(demo);
    await createJob(new File(['existing'], 'existing.step'));
    const file = new File(['captured source'], 'slow.step');
    let release!: () => void;
    let started!: () => void;
    const reading = new Promise<void>(resolve => (started = resolve));
    vi.spyOn(file, 'arrayBuffer').mockImplementation(
      () =>
        new Promise<ArrayBuffer>(resolve => {
          release = () => resolve(new TextEncoder().encode('captured source').buffer as ArrayBuffer);
          started();
        })
    );
    const creating = createJob(file);
    await reading;
    closeUnexpectedly(opened(demo).at(-1)!);
    setDemoModeForTest(!demo);
    release();
    const created = await creating;
    expect(await getJob(created.id)).toBeNull();
    setDemoModeForTest(demo);
    expect(await getJob(created.id)).toEqual(created);
    expect(new TextDecoder().decode((await getModelBytes(created.id))!)).toBe('captured source');
    expect(opened(demo)).toHaveLength(2);
  });
});
