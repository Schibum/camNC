import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { page } from '@vitest/browser/context';
import type { ComponentType, ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import '@/style.css';
import { Route } from './start';

const router = vi.hoisted(() => ({ navigate: vi.fn(), search: {} as { for?: 'cam'; job?: string; board?: string } }));
const store = vi.hoisted(() => ({
  setMachineBounds: vi.fn(),
  toolpath: null as object | null,
  camSources: {} as Record<string, object>,
  saved: null as { min: { x: number; y: number }; max: { x: number; y: number } } | null,
}));
const files = vi.hoisted(() => ({ picked: null as File | null, open: vi.fn() }));
const sample = vi.hoisted(() => ({ open: vi.fn() }));

const toastInfo = vi.hoisted(() => vi.fn());
vi.mock('@wbcnc/ui/components/sonner', () => ({ toast: { info: toastInfo, success: vi.fn(), error: vi.fn() } }));
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: unknown) => ({ options }),
  useNavigate: () => router.navigate,
  useSearch: () => router.search,
  Link: ({ children, to, search }: { children: ReactNode; to: string; search?: { new?: boolean } }) => (
    <a href={search?.new ? `${to}?new=true` : to}>{children}</a>
  ),
}));
vi.mock('@/components/page-header', () => ({ PageHeader: () => null }));
vi.mock('@/visualize/DepthInspector', () => ({ kDepthSceneBackground: 'black' }));
vi.mock('@/visualize/useOpenFile', () => ({ pickFile: async () => files.picked, useOpenFile: () => files.open }));
vi.mock('@/cam/samples/useOpenSample', () => ({ useOpenSample: () => ({ open: sample.open, pending: false, error: null }) }));
vi.mock('@/start/ConnectMachineButton', () => ({
  ConnectMachineButton: ({ onBedRead, onClosed }: { onBedRead: (b: object) => void; onClosed: () => void }) => (
    <>
      <button onClick={() => onBedRead({ xmin: 3, xmax: 1223, ymin: 3, ymax: 2443 })}>Read machine</button>
      <button onClick={onClosed}>Close dialog</button>
    </>
  ),
}));
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
  useMachineBoundsOrNull: () => store.saved,
}));

const Start = (Route as unknown as { options: { component: ComponentType } }).options.component;

function pickSize(name: RegExp) {
  fireEvent.click(screen.getByRole('button', { name: /^Bed size/ }));
  fireEvent.click(screen.getByRole('button', { name }));
}

afterEach(() => {
  cleanup();
  router.navigate.mockReset();
  router.search = {};
  toastInfo.mockReset();
  store.setMachineBounds.mockReset();
  store.toolpath = null;
  store.camSources = {};
  store.saved = null;
  files.picked = null;
  files.open.mockReset();
  sample.open.mockReset();
});

describe('getting started', () => {
  it('saves nothing just for drawing a bed, or for choosing a size', () => {
    render(<Start />);
    expect(screen.getByTestId('drawn-bed').getAttribute('viewBox')).toBe('0 0 2440 1220');
    expect(screen.queryByRole('button', { name: 'Open workspace' })).toBeNull();
    pickSize(/Desktop/);
    expect(screen.getByTestId('drawn-bed').getAttribute('viewBox')).toBe('0 0 300 300');
    expect(store.setMachineBounds).not.toHaveBeenCalled();
    expect(router.navigate).not.toHaveBeenCalled();
  });

  it('opens the workspace with the chosen size, no machine or camera needed', () => {
    render(<Start />);
    pickSize(/Small/);
    fireEvent.click(screen.getByRole('button', { name: 'Open workspace' }));
    expect(store.setMachineBounds).toHaveBeenCalledWith(0, 0, 600, 600);
    expect(router.navigate).toHaveBeenCalledWith({ to: '/visualize/2DView' });
  });

  it('draws the bed the controller reports and saves it with the workspace', () => {
    render(<Start />);
    fireEvent.click(screen.getByRole('button', { name: 'Read machine' }));
    expect(screen.getByTestId('drawn-bed').getAttribute('viewBox')).toBe('0 0 2440 1220');
    fireEvent.click(screen.getByRole('button', { name: 'Open workspace' }));
    expect(store.setMachineBounds).toHaveBeenCalledWith(3, 3, 1223, 2443);
  });

  it('keeps the bed the controller reports once the dialog closes, when there is no other size', () => {
    render(<Start />);
    fireEvent.click(screen.getByRole('button', { name: 'Read machine' }));
    fireEvent.click(screen.getByRole('button', { name: 'Close dialog' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open workspace' }));
    expect(store.setMachineBounds).toHaveBeenCalledWith(3, 3, 1223, 2443);
  });

  it('goes back to the chosen size when the dialog closes without confirming the controller’s', () => {
    render(<Start />);
    pickSize(/Small/);
    fireEvent.click(screen.getByRole('button', { name: 'Read machine' }));
    expect(screen.getByTestId('drawn-bed').getAttribute('viewBox')).toBe('0 0 2440 1220');
    fireEvent.click(screen.getByRole('button', { name: 'Close dialog' }));
    expect(screen.getByTestId('drawn-bed').getAttribute('viewBox')).toBe('0 0 600 600');
    fireEvent.click(screen.getByRole('button', { name: 'Open workspace' }));
    expect(store.setMachineBounds).toHaveBeenCalledWith(0, 0, 600, 600);
  });

  it('does not overwrite saved bounds with the controller’s until confirmed', () => {
    store.saved = { min: { x: 3, y: 3 }, max: { x: 621, y: 1241 } };
    render(<Start />);
    fireEvent.click(screen.getByRole('button', { name: 'Read machine' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open workspace' }));
    expect(store.setMachineBounds).not.toHaveBeenCalled();
  });

  it('keeps saved bounds when the workspace opens without another size chosen', () => {
    store.saved = { min: { x: 6, y: 6 }, max: { x: 606, y: 1206 } };
    render(<Start />);
    expect(screen.getByTestId('drawn-bed').getAttribute('viewBox')).toBe('0 0 1200 600');
    fireEvent.click(screen.getByRole('button', { name: 'Open workspace' }));
    expect(store.setMachineBounds).not.toHaveBeenCalled();
    expect(router.navigate).toHaveBeenCalledWith({ to: '/visualize/2DView' });
  });

  it('shows newly opened G-code on the drawn bed and says which size it assumed', () => {
    const { rerender } = render(<Start />);
    store.toolpath = {};
    rerender(<Start />);
    expect(store.setMachineBounds).toHaveBeenCalledWith(0, 0, 1220, 2440);
    expect(router.navigate).toHaveBeenCalledWith({ to: '/visualize/2DView' });
    expect(toastInfo).toHaveBeenCalledTimes(1);
    expect(toastInfo.mock.calls[0]![0]).toMatch(/^Showing it on a 1220 × 2440 mm bed/);
  });

  it('stays on the page with a program from before', () => {
    store.toolpath = {};
    render(<Start />);
    expect(router.navigate).not.toHaveBeenCalled();
  });

  it('opens a chosen file by its type, and the sample', async () => {
    files.picked = new File([''], 'part.step');
    render(<Start />);
    fireEvent.click(screen.getByRole('button', { name: 'Choose file' }));
    await waitFor(() => expect(files.open).toHaveBeenCalledWith(files.picked));
    fireEvent.click(screen.getByRole('button', { name: 'Use a sample' }));
    expect(sample.open).toHaveBeenCalled();
  });

  it('from CAM: says to pick a bed first, then shows the loaded program without the open-a-file hint', () => {
    router.search = { for: 'cam' };
    render(<Start />);
    expect(screen.getByRole('status').textContent).toMatch(/^Pick your bed first\. Then camNC shows your CAM program on it/);
    pickSize(/Full sheet/);
    fireEvent.click(screen.getByRole('button', { name: 'Show on this bed' }));
    expect(store.setMachineBounds).toHaveBeenCalledWith(0, 0, 1220, 2440);
    expect(router.navigate).toHaveBeenCalledWith({ to: '/visualize/2DView' });
    expect(toastInfo).not.toHaveBeenCalled();
  });

  it('carries the current job and board into rehearsal without unrelated onboarding', () => {
    router.search = { for: 'cam', job: 'current-job', board: 'B' };
    render(<Start />);
    expect(screen.getByText('Rehearse current-job / B')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Try the demo' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Add a camera' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Restore a backup' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Choose file' })).toBeNull();
  });

  it('offers a custom size, the demo and the camera setup', () => {
    render(<Start />);
    fireEvent.click(screen.getByRole('button', { name: /^Bed size/ }));
    expect(screen.queryByText('Custom bounds form')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Custom size…' }));
    expect(screen.getByText('Custom bounds form')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Try the demo' }).getAttribute('href')).toBe('/demo');
    expect(screen.getByRole('link', { name: 'Add a camera' }).getAttribute('href')).toBe('/setup/url-entry');
  });

  it('leaves out the demo once a camera is set up, and adds a new camera instead of changing it', () => {
    store.camSources = { cam: {} };
    render(<Start />);
    expect(screen.queryByRole('link', { name: 'Try the demo' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Add a camera' }).getAttribute('href')).toBe('/setup/url-entry?new=true');
  });

  it('keeps its links above the tabs on a phone', async () => {
    await page.viewport(375, 812);
    try {
      render(<Start />);
      const kTabsTop = 812 - 56;
      expect(screen.getByRole('link', { name: 'Add a camera' }).getBoundingClientRect().bottom).toBeLessThanOrEqual(kTabsTop);
    } finally {
      await page.viewport(1280, 800);
    }
  });
});
