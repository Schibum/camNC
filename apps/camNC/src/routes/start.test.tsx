import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ComponentType, ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Route } from './start';

const router = vi.hoisted(() => ({ navigate: vi.fn(), search: {} as { for?: 'cam'; job?: string; board?: string } }));
const store = vi.hoisted(() => ({ setMachineBounds: vi.fn() }));

const toastInfo = vi.hoisted(() => vi.fn());
vi.mock('@wbcnc/ui/components/sonner', () => ({ toast: { info: toastInfo, success: vi.fn(), error: vi.fn() } }));
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: unknown) => ({ options }),
  useNavigate: () => router.navigate,
  useSearch: () => router.search,
  Link: ({ children, to }: { children: ReactNode; to: string }) => <a href={to}>{children}</a>,
}));
vi.mock('@/components/page-header', () => ({ PageHeader: () => null }));
vi.mock('@/components/machine/MachineConnectionForm', () => ({ MachineConnectionForm: () => null }));
vi.mock('@/start/BedFromMachine', () => ({ BedFromMachine: () => null }));
vi.mock('@/lib/demo/TryDemoCard', () => ({ TryDemoCard: () => <p>Try the demo</p> }));
vi.mock('@/start/CamJobRehearsal', () => ({
  CamJobRehearsal: ({ jobId, boardId }: { jobId: string; boardId?: string }) => (
    <p>
      Rehearse {jobId} / {boardId}
    </p>
  ),
}));
vi.mock('@/setup/MachineBoundsForm', () => ({ MachineBoundsForm: () => <p>Custom bounds form</p> }));
vi.mock('@/store/store', () => ({
  useStore: (selector: (state: typeof store) => unknown) => selector(store),
}));

const Start = (Route as unknown as { options: { component: ComponentType } }).options.component;

afterEach(() => {
  cleanup();
  router.navigate.mockReset();
  router.search = {};
  toastInfo.mockReset();
  store.setMachineBounds.mockReset();
});

describe('getting started', () => {
  it('opens the workspace with a preset bed, no machine or camera needed', () => {
    render(<Start />);
    fireEvent.click(screen.getByRole('button', { name: /Full sheet/ }));
    expect(store.setMachineBounds).toHaveBeenCalledWith(0, 0, 1220, 2440);
    expect(router.navigate).toHaveBeenCalledWith({ to: '/visualize/2DView' });
  });

  it('from CAM: says to pick a bed first, then shows the loaded program without the open-a-file hint', () => {
    router.search = { for: 'cam' };
    render(<Start />);
    expect(screen.getByRole('status').textContent).toMatch(/^Pick your bed first\. Then camNC shows your CAM program on it/);
    fireEvent.click(screen.getByRole('button', { name: /Full sheet/ }));
    expect(router.navigate).toHaveBeenCalledWith({ to: '/visualize/2DView' });
    expect(toastInfo).not.toHaveBeenCalled();
  });

  it('carries the current job and board into rehearsal without unrelated onboarding', () => {
    router.search = { for: 'cam', job: 'current-job', board: 'B' };
    render(<Start />);
    expect(screen.getByText('Rehearse current-job / B')).toBeTruthy();
    expect(screen.queryByText('Try the demo')).toBeNull();
    expect(screen.queryByRole('link', { name: 'Set it up now' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Restore a backup' })).toBeNull();
    expect(screen.queryByRole('link', { name: /Open CAM/ })).toBeNull();
  });

  it('offers a custom size, the demo and the camera setup', () => {
    render(<Start />);
    expect(screen.queryByText('Custom bounds form')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Custom size…' }));
    expect(screen.getByText('Custom bounds form')).toBeTruthy();
    expect(screen.getByText('Try the demo')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Set it up now' }).getAttribute('href')).toBe('/setup/url-entry');
  });
});
