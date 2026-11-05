import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { camKeys, modelKey, useCamModel, useSaveCamJob } from './camQueries';
import type { ModelImport } from './camTypes';
import { createJob, deleteJob, getJob, replaceModel, saveJob } from './jobDb';
import { setDemoModeForTest } from '@/lib/demo/demo-mode';
import { kDefaultPlan } from './planSettings';

const imports = vi.hoisted(
  () =>
    [] as {
      resolve: (model: ModelImport) => void;
      reject: (error: Error) => void;
    }[]
);
vi.mock('comlink', async importOriginal => ({
  ...(await importOriginal<typeof import('comlink')>()),
  wrap: () => ({
    importModel: () => new Promise<ModelImport>((resolve, reject) => imports.push({ resolve, reject })),
  }),
  transfer: (value: unknown) => value,
}));

// Delay the import's return after its transaction commits: a field can save before that response is published.
const publication = vi.hoisted(() => ({ blocked: false, releases: [] as (() => void)[] }));
vi.mock('./jobDb', async importOriginal => {
  const original = await importOriginal<typeof import('./jobDb')>();
  return {
    ...original,
    updateJobForModel: async (...args: Parameters<typeof original.updateJobForModel>) => {
      const saved = await original.updateJobForModel(...args);
      if (publication.blocked) await new Promise<void>(resolve => publication.releases.push(resolve));
      return saved;
    },
  };
});

const model = (name: string): ModelImport => ({
  parts: [
    {
      id: 'part-0',
      name,
      names: [name],
      size: [40, 20, 8],
      thickness: 8,
      summary: {
        chips: [],
        needsFlip: false,
        bottomDepths: [],
        notFlat: false,
        prismaticRatio: 1,
        slopedShare: 0,
        slopedArea: 0,
        smallestInsideRadius: null,
      },
      shape: {
        outlines: [
          [
            [0, 0],
            [40, 0],
            [40, 20],
            [0, 20],
          ],
        ],
        holes: [],
        pockets: [],
      },
    },
  ],
  meshes: [],
  readMs: 0,
  analyzeMs: 0,
});

afterEach(() => {
  setDemoModeForTest(false);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  imports.length = 0;
  publication.blocked = false;
  publication.releases.splice(0).forEach(release => release());
});

describe.each([false, true])('model import completion (demo: %s)', demo => {
  async function begin() {
    setDemoModeForTest(demo);
    vi.stubGlobal('Worker', class {});
    const job = await createJob(new File(['old'], 'same.step'));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(camKeys.job(job.id), job);
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const hook = renderHook(({ job }) => useCamModel(job), { initialProps: { job }, wrapper });
    await vi.waitFor(() => expect(imports).toHaveLength(1));
    return { job, client, wrapper, ...hook };
  }

  it('saves the supplied document when no rendered or cached base is available', async () => {
    setDemoModeForTest(demo);
    const job = await createJob(new File(['model'], 'uncached.step'));
    const client = new QueryClient();
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const save = renderHook(() => useSaveCamJob(), { wrapper });
    await act(async () => save.result.current.mutate({ ...job, name: 'Uncached edit' }));
    await vi.waitFor(() => expect(save.result.current.isSuccess).toBe(true));
    expect((await getJob(job.id))?.name).toBe('Uncached edit');
  });

  it.each(['success', 'failure'] as const)('ignores a replaced model’s late %s', async outcome => {
    const { job, client, result, rerender } = await begin();
    const replaced = await replaceModel(job, new File(['new'], 'same.step'));
    act(() => {
      client.setQueryData(camKeys.job(job.id), replaced);
      rerender({ job: replaced });
    });
    await vi.waitFor(() => expect(imports).toHaveLength(2));
    await act(async () => imports[1].resolve(model('New part')));
    await vi.waitFor(() => expect(result.current.isSuccess).toBe(true));
    const current = await getJob(job.id);
    await act(async () => (outcome === 'success' ? imports[0].resolve(model('Old part')) : imports[0].reject(new Error('bad old file'))));
    await vi.waitFor(() =>
      expect(client.getQueryState(camKeys.model(modelKey(job)))?.status).toBe(outcome === 'success' ? 'success' : 'error')
    );
    expect(await getJob(job.id)).toEqual(current);
    expect(client.getQueryData(camKeys.job(job.id))).toEqual(current);
    expect(current?.parts[0].name).toBe('New part');
    expect(current?.partsFrom?.revision).toBe(1);
  });

  it.each(['success', 'failure'] as const)('does not restore a deleted job after import %s', async outcome => {
    const { job, client } = await begin();
    await deleteJob(job.id);
    await act(async () => (outcome === 'success' ? imports[0].resolve(model('Old part')) : imports[0].reject(new Error('bad old file'))));
    await vi.waitFor(() =>
      expect(client.getQueryState(camKeys.model(modelKey(job)))?.status).toBe(outcome === 'success' ? 'success' : 'error')
    );
    expect(await getJob(job.id)).toBeNull();
  });

  it.skipIf(demo)('rebases an edit queued before the import transaction reads the job', async () => {
    const { job, client, wrapper, result } = await begin();
    const save = renderHook(() => useSaveCamJob(job), { wrapper });
    const get = IDBObjectStore.prototype.get;
    let queued = false;
    vi.spyOn(IDBObjectStore.prototype, 'get').mockImplementation(function (this: IDBObjectStore, key) {
      const req = get.call(this, key);
      if (!queued && this.name === 'jobs' && this.transaction.mode === 'readwrite' && key === job.id) {
        queued = true;
        // The import's read is already queued; this edit still sees the job before imported parts exist.
        queueMicrotask(() => save.result.current.mutate({ ...job, name: 'Edited before import read' }));
      }
      return req;
    });
    await act(async () => imports[0].resolve(model('Imported part')));
    await vi.waitFor(() => expect(result.current.isSuccess && save.result.current.isSuccess).toBe(true));
    expect(queued).toBe(true);
    const saved = await getJob(job.id);
    expect(saved?.name).toBe('Edited before import read');
    expect(saved?.parts[0]?.name).toBe('Imported part');
    expect(saved?.partsFrom?.revision).toBe(0);
    const cached = client.getQueryData<typeof job>(camKeys.job(job.id));
    expect(cached?.name).toBe(saved?.name);
    expect(cached?.parts).toEqual(saved?.parts);
  });

  it('keeps imported parts when a later user save finishes before the import response', async () => {
    const { job, client, wrapper, result } = await begin();
    const save = renderHook(() => useSaveCamJob(job), { wrapper });
    publication.blocked = true;
    await act(async () => imports[0].resolve(model('Imported part')));
    await vi.waitFor(() => expect(publication.releases).toHaveLength(1));
    await act(async () => save.result.current.mutate({ ...job, name: 'New job name' }));
    await vi.waitFor(() => expect(save.result.current.isSuccess).toBe(true));
    await act(async () => publication.releases[0]());
    await vi.waitFor(() => expect(result.current.isSuccess).toBe(true));
    const saved = await getJob(job.id);
    expect(saved?.name).toBe('New job name');
    expect(saved?.parts[0]?.name).toBe('Imported part');
    expect(saved?.partsFrom?.revision).toBe(0);
    expect(client.getQueryData(camKeys.job(job.id))).toEqual(saved);
  });

  it('carries names and milled choices from edits saved while importing', async () => {
    const { job, client, result } = await begin();
    const edited = await saveJob({
      ...job,
      name: 'Renamed job',
      parts: [{ id: 'part-0', name: 'My part', quantity: 1, milled: false }],
      plan: { ...kDefaultPlan, bit: { ...kDefaultPlan.bit, diameter: 3 } },
    });
    client.setQueryData(camKeys.job(job.id), edited);
    await act(async () => imports[0].resolve(model('Original part')));
    await vi.waitFor(() => expect(result.current.isSuccess).toBe(true));
    const saved = await getJob(job.id);
    expect(saved?.name).toBe('Renamed job');
    expect(saved?.parts).toEqual(edited.parts);
    expect(saved?.plan).toEqual(edited.plan);
    expect(client.getQueryData(camKeys.job(job.id))).toEqual(saved);
  });
});
