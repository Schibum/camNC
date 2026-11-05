import { createJob, getJob, listJobs, saveJob } from '@/cam/jobDb';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ComponentType, ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Route } from './index';

const toastError = vi.hoisted(() => vi.fn());
const picked = vi.hoisted(() => ({ file: null as File | null }));

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: unknown) => ({ options }),
  useNavigate: () => () => undefined,
  useSearch: () => ({}),
  Link: ({ children, className }: { children: ReactNode; className?: string }) => <a className={className}>{children}</a>,
}));
vi.mock('@/components/page-header', () => ({ PageHeader: () => null }));
vi.mock('@wbcnc/ui/components/sonner', () => ({ toast: Object.assign(vi.fn(), { error: toastError }) }));
vi.mock('@/cam/openModelFile', async importOriginal => ({
  ...(await importOriginal<typeof import('@/cam/openModelFile')>()),
  pickModelFile: async () => picked.file,
}));

const CamIndex = (Route as unknown as { options: { component: ComponentType } }).options.component;

afterEach(cleanup);

const renderIndex = () =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <CamIndex />
    </QueryClientProvider>
  );

describe('CAM job list', () => {
  it('says so when the picked file is not a model, and makes no job', async () => {
    const before = (await listJobs()).length;
    picked.file = new File(['hello'], 'notes.txt');
    renderIndex();
    fireEvent.click(screen.getByRole('button', { name: /Open model/ }));
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith('Not a STEP or STL file', { description: expect.stringContaining('notes.txt') })
    );
    expect(await listJobs()).toHaveLength(before);
  });

  it('marks a job whose model could not be read, and offers to delete it', async () => {
    const job = await createJob(new File(['x'], `broken-${crypto.randomUUID()}.step`));
    await saveJob({ ...job, readError: 'broken.step could not be read' });
    renderIndex();
    const row = (await screen.findByText(job.name)).closest('li')!;
    expect(within(row).getByText('Could not be read')).toBeTruthy();
    fireEvent.click(within(row).getByRole('button', { name: `Delete ${job.name}` }));
    await waitFor(async () => expect(await getJob(job.id)).toBeNull());
  });

  it('labels a job opened from the same file again', async () => {
    const name = `regal-${crypto.randomUUID()}`;
    const first = await createJob(new File(['x'], `${name}.step`));
    const second = await createJob(new File(['x'], `${name}.step`));
    expect([first.name, second.name]).toEqual([name, `${name} (2)`]);
  });
});
