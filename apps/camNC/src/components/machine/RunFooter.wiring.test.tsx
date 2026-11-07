import { Vector3 } from 'three';
import { signal } from '@preact/signals-react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useCamMachine } from '@/cam/machine/camMachine';
import { useStore } from '@/store/store';
import { RunFooter } from './RunFooter';
const h = vi.hoisted(() => ({
  api: null as unknown as import('@/lib/fluidnc/cnc-api').CncApi,
  zero: vi.fn(),
  keep: vi.fn(),
  move: vi.fn(),
}));
vi.mock('@/lib/fluidnc/machine', () => ({ getCncApi: () => h.api, getExistingCncApi: () => h.api }));
vi.mock('@/lib/machine/jobs', () => ({
  zeroAndRun: h.zero,
  uploadAndRun: h.keep,
  moveToolpathToMachineZero: h.move,
  useJobChecklist: () => [],
  errorText: (error: Error) => error.message,
  machineZeroPreview: { value: false },
  moveTargetPreview: { value: null },
  setXYZeroFromToolpath: vi.fn(),
  zeroXYAtBit: vi.fn(),
}));
vi.mock('./useProbeZ', () => ({ useProbeZ: () => ({ probe: vi.fn(), prefs: { probePlateThickness: 1, probeMaxTravel: 50 } }) }));
vi.mock('@wbcnc/ui/components/sonner', () => ({ toast: { error: vi.fn() } }));
beforeEach(() => {
  useCamMachine.setState(useCamMachine.getInitialState(), true);
  useStore.setState(useStore.getInitialState(), true);
  useStore.getState().updateToolpath('G21 G90\nG1 X20 F300', 'Test');
  h.api = {
    homed: signal(true),
    isConnected: signal(true),
    state: signal('Idle'),
    zZeroedAt: signal(1),
    currentZero: signal({ x: 0, y: 0, z: 0 }),
    travel: signal(null),
    status: signal({ state: 'Idle', wco: { x: 0, y: 0, z: 0 } }),
    jobProgress: signal(null),
    jobStartedAt: signal(null),
  } as unknown as typeof h.api;
  h.zero.mockReset().mockResolvedValue(undefined);
  h.keep.mockReset().mockResolvedValue(undefined);
  h.move.mockReset().mockResolvedValue(true);
});
afterEach(() => {
  cleanup();
  useCamMachine.setState(useCamMachine.getInitialState(), true);
});
const confirm = () => fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: /^Run$/ }));
async function keepDialog() {
  fireEvent.keyDown(screen.getByRole('button', { name: 'More actions' }), { key: 'Enter' });
  fireEvent.click(await screen.findByRole('menuitem', { name: "Run from the machine's zero" }));
}
it('wires ordinary Run to zeroAndRun only', async () => {
  render(<RunFooter />);
  fireEvent.click(screen.getByRole('button', { name: 'Run job' }));
  confirm();
  await waitFor(() => expect(h.zero).toHaveBeenCalledOnce());
  expect(h.keep).not.toHaveBeenCalled();
  expect(h.move).not.toHaveBeenCalled();
});
it('awaits a successful saved placement before the keep-zero dispatch', async () => {
  let resolve!: (saved: boolean) => void;
  h.move.mockImplementation(
    () =>
      new Promise<boolean>(r => {
        resolve = r;
      })
  );
  render(<RunFooter />);
  await keepDialog();
  confirm();
  expect(h.move).toHaveBeenCalledOnce();
  expect(h.keep).not.toHaveBeenCalled();
  resolve(true);
  await waitFor(() => expect(h.keep).toHaveBeenCalledOnce());
  expect(h.zero).not.toHaveBeenCalled();
});
it('does not dispatch when the keep-zero placement is refused', async () => {
  h.move.mockResolvedValue(false);
  render(<RunFooter />);
  await keepDialog();
  confirm();
  await waitFor(() => expect(h.move).toHaveBeenCalledOnce());
  expect(h.keep).not.toHaveBeenCalled();
  expect(h.zero).not.toHaveBeenCalled();
});
it.each(['preparing', 'review', 'running'] as const)('disables Run and zero-changing menu actions during %s', async mode => {
  if (mode === 'preparing') useCamMachine.setState({ preparingRun: true });
  if (mode === 'review') useCamMachine.setState({ runReview: 'finished', runSnapshot: {} as never });
  if (mode === 'running') h.api.jobStartedAt.value = 123;
  render(<RunFooter />);
  expect((screen.getByRole('button', { name: 'Run job' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.keyDown(screen.getByRole('button', { name: 'More actions' }), { key: 'Enter' });
  expect((await screen.findByRole('menuitem', { name: /^Set XY zero$/ })).getAttribute('aria-disabled')).toBe('true');
  expect(screen.getByRole('menuitem', { name: "Run from the machine's zero" }).getAttribute('aria-disabled')).toBe('true');
  expect(h.zero).not.toHaveBeenCalled();
  expect(h.keep).not.toHaveBeenCalled();
});

it('keeps the moved-zero and partly-cut warning visible after a refused zero-and-run', async () => {
  useStore.getState().setToolpathOffset(new Vector3(120, 240, 0));
  useCamMachine.setState({ midBoard: true });
  h.zero.mockRejectedValue(new Error('G10 rejected'));
  render(<RunFooter />);
  fireEvent.click(screen.getByRole('button', { name: 'Run job' }));
  expect(screen.getByRole('alertdialog').textContent).toContain('Sets XY zero where the job is drawn');
  expect(screen.getByRole('alertdialog').textContent).toContain('already has cuts from the old zero');
  confirm();
  await screen.findByText('G10 rejected', { exact: false });
  await waitFor(() => expect((screen.getByRole('button', { name: 'Run job' }) as HTMLButtonElement).disabled).toBe(false), {
    timeout: 3000,
  });
  fireEvent.click(screen.getByRole('button', { name: 'Run job' }));
  expect(screen.getByRole('alertdialog').textContent).toContain('Sets XY zero where the job is drawn');
  expect(screen.getByRole('alertdialog').textContent).toContain('already has cuts from the old zero');
});
