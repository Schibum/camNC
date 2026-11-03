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
});
