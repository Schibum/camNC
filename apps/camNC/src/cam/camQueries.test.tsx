import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { camKeys, useSaveCamJob } from './camQueries';
import type { CamJobV1 } from './jobDb';

// Saves that finish in the order the test says, like IndexedDB writes on a slow machine.
const pending = vi.hoisted(() => [] as { job: CamJobV1; resolve: (j: CamJobV1) => void }[]);
vi.mock('./jobDb', async importOriginal => ({
  ...(await importOriginal<typeof import('./jobDb')>()),
  saveJob: (job: CamJobV1) => new Promise<CamJobV1>(resolve => pending.push({ job, resolve })),
}));

const job = (boards: string[]): CamJobV1 =>
  ({
    v: 1,
    id: 'j',
    name: 'j',
    fileName: 'j.step',
    createdAt: 0,
    updatedAt: 0,
    parts: [],
    boards: boards.map(name => ({ name })),
  }) as unknown as CamJobV1;

describe('saving a CAM job', () => {
  it('keeps the newest edit when an older save finishes last', async () => {
    const client = new QueryClient();
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const { result } = renderHook(() => useSaveCamJob(), { wrapper });
    const boardsNow = () => client.getQueryData<CamJobV1>(camKeys.job('j'))!.boards!.map(b => b.name);

    await act(async () => result.current.mutate(job(['A', 'B'])));
    await act(async () => result.current.mutate(job(['A', 'B', 'C'])));
    await vi.waitFor(() => expect(pending).toHaveLength(2));
    expect(boardsNow()).toEqual(['A', 'B', 'C']);
    // The first save finishes now: it must not bring back the job without board C.
    await act(async () => pending[0].resolve({ ...pending[0].job, updatedAt: 1 }));
    expect(boardsNow()).toEqual(['A', 'B', 'C']);
    await act(async () => pending[1].resolve({ ...pending[1].job, updatedAt: 2 }));
    expect(boardsNow()).toEqual(['A', 'B', 'C']);
    expect(client.getQueryData<CamJobV1>(camKeys.job('j'))!.updatedAt).toBe(2);
  });

  it('two saves built from the same render, with no render between them: the second keeps what the first changed', async () => {
    pending.length = 0;
    const board = (id: string, over: object) => ({ id, name: id, items: [], ...over });
    const rendered = { ...job([]), boards: [board('A', { items: ['p'] }), board('C', {})] } as unknown as CamJobV1;
    const client = new QueryClient();
    client.setQueryData(camKeys.job('j'), rendered);
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const { result } = renderHook(() => useSaveCamJob(rendered), { wrapper });
    const save = result.current;
    await act(async () => {
      // The drop moves p to C; right after it, a size field on C commits, from the same render where C is still empty.
      save.mutate({ ...rendered, boards: [board('A', {}), board('C', { items: ['p'] })] } as unknown as CamJobV1);
      save.mutate({ ...rendered, boards: [board('A', { items: ['p'] }), board('C', { margin: 9 })] } as unknown as CamJobV1);
    });
    await vi.waitFor(() => expect(pending).toHaveLength(2));
    // The last write to the database has both, and neither board lost its part.
    const c = pending[1].job.boards!.find(b => b.id === 'C')!;
    expect(c.items).toEqual(['p']);
    expect(c.margin).toBe(9);
    expect(pending[1].job.boards!.find(b => b.id === 'A')!.items).toEqual([]);
    expect(client.getQueryData<CamJobV1>(camKeys.job('j'))!.boards!.find(b => b.id === 'C')!.items).toEqual(['p']);
  });
});
