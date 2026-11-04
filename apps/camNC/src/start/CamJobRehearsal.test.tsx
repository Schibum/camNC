import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSampleJob } from '@/cam/samples/createSampleJob';
import { getJob } from '@/cam/jobDb';
import { useCamMachine } from '@/cam/machine/camMachine';
import { CamJobRehearsal } from './CamJobRehearsal';

const launch = vi.hoisted(() => vi.fn());
vi.mock('@/lib/rehearsal/rehearsal', () => ({ launchRehearsal: launch }));
vi.mock('@/cam/machine/useMachineBusy', () => ({ useMachineBusy: () => false }));
vi.mock('@tanstack/react-router', () => ({ Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a> }));
afterEach(() => {
  cleanup();
  launch.mockReset();
  useCamMachine.getState().leave();
});
const show = (jobId: string, boardId?: string) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <CamJobRehearsal jobId={jobId} boardId={boardId} />
    </QueryClientProvider>
  );

describe('CAM setup rehearsal', () => {
  it('rehearses the explicit STEP job and selected board, even with a different job in the machine queue', async () => {
    const job = await createSampleJob();
    const before = await getJob(job.id);
    useCamMachine.getState().start('previous-unrelated-job');
    show(job.id, 'auto-3mm');
    const trigger = await screen.findByRole<HTMLButtonElement>('button', { name: 'Try on demo machine' });
    await waitFor(() => expect(trigger.disabled).toBe(false), { timeout: 60_000 });
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('button', { name: 'Start rehearsal' }));
    await waitFor(() => expect(launch).toHaveBeenCalledTimes(1));
    const [source, boards, signal, boardId] = launch.mock.calls[0];
    expect(source.id).toBe(job.id);
    expect(source.fileName).toBe('Standing shelf.step');
    expect(boardId).toBe('auto-3mm');
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(boards.length).toBeGreaterThan(0);
    for (const board of boards) {
      expect(board.size.fit).toBe(false);
      expect(Object.keys(board.positions).sort()).toEqual(board.items.toSorted());
      expect(board.pinned.toSorted()).toEqual(board.items.toSorted());
    }
    expect(useCamMachine.getState().jobId).toBe('previous-unrelated-job');
    // Import may fill names and parts in the ordinary source; rehearsal does not change its plan or cut history.
    expect((await getJob(job.id))!.plan).toEqual(before!.plan);
  }, 60_000);

  it('explains a missing source instead of offering the unrelated generic demo', async () => {
    show('missing-project');
    expect((await screen.findByRole('alert')).textContent).toContain('no longer available');
    expect(screen.queryByRole('button', { name: 'Try on demo machine' })).toBeNull();
    expect(launch).not.toHaveBeenCalled();
  });
});
