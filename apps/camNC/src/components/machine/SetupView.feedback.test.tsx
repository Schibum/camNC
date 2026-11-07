import { signal } from '@preact/signals-react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useCamMachine } from '@/cam/machine/camMachine';
import type { ManufacturingSnapshot } from '@/cam/machine/manufacturingSnapshot';
import { useStore } from '@/store/store';
import { SetupView } from './SetupView';
const h = vi.hoisted(() => ({ api: null as unknown as import('@/lib/fluidnc/cnc-api').CncApi, run: vi.fn() }));
vi.mock('@/lib/fluidnc/machine', () => ({ getCncApi: () => h.api, getExistingCncApi: () => h.api }));
vi.mock('@/lib/fluidnc/machineInstance', () => ({ getExistingCncApi: () => h.api }));
vi.mock('@/lib/machine/jobs', () => ({
  uploadAndRun: h.run,
  zeroAndRun: h.run,
  machineZeroPreview: signal(false),
  moveTargetPreview: signal(null),
  moveToolpathToMachineZero: vi.fn(),
  zeroXYAtBit: vi.fn(),
  useJobChecklist: () => [],
  errorText: (e: Error) => e.message,
  setXYZeroFromToolpath: vi.fn(),
  kJobFileName: 'camnc.gcode',
}));
vi.mock('./AlarmCard', () => ({ AlarmCard: () => null }));
vi.mock('./ResumeJobCard', () => ({ ResumeJobCard: () => null }));
vi.mock('@/cam/machine/CamQueueCard', () => ({ CamQueueCard: () => null }));
vi.mock('./controls', () => ({ JogPanel: () => null, JogFeeds: () => null, ProbeSettings: () => null }));
vi.mock('./macros', () => ({ MacroButtons: () => null }));
vi.mock('./useProbeZ', () => ({
  useProbeZ: () => ({ probe: vi.fn(), disabled: true, prefs: { probePlateThickness: 1, probeMaxTravel: 10 } }),
}));
vi.mock('@wbcnc/ui/components/sonner', () => ({ toast: { error: vi.fn() } }));
beforeEach(() => {
  useCamMachine.setState(useCamMachine.getInitialState(), true);
  useStore.setState(useStore.getInitialState(), true);
  useStore.getState().updateToolpath('G21\nG1 X20 F300', 'Plate');
  h.api = {
    homed: signal(true),
    currentZero: signal(null),
    travel: signal(null),
    isConnected: signal(true),
    state: signal('Idle'),
    status: signal({ state: 'Idle' }),
    jobProgress: signal(null),
    jobStartedAt: signal(null),
    zZeroedAt: signal(1),
  } as unknown as typeof h.api;
  h.run.mockReset().mockResolvedValue(undefined);
});
afterEach(() => {
  cleanup();
  useCamMachine.setState(useCamMachine.getInitialState(), true);
});
it('P1 disables Run and explains a finished native setup review while the machine is idle', () => {
  useCamMachine.setState({ runReview: 'finished', runSnapshot: {} as ManufacturingSnapshot });
  render(<SetupView onEditMacros={() => {}} />);
  expect((screen.getByRole('button', { name: 'Run job' }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByText(/finished.*review|review.*finished/i)).toBeTruthy();
});
it('P1 shows a refused start in the page after the confirmation closes', async () => {
  h.run.mockRejectedValue(new Error('Another execution replaced this preparation. Execution was not requested.'));
  render(<SetupView onEditMacros={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: 'Run job' }));
  fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: /^Run$/ }));
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Another execution replaced'));
  expect(h.run).toHaveBeenCalledTimes(1);
});
it('P9 describes an execution-specific upload instead of promising the obsolete shared filename', () => {
  render(<SetupView onEditMacros={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: 'Run job' }));
  const dialog = screen.getByRole('alertdialog');
  expect(dialog.textContent).toMatch(/unique.*file|execution.*file/i);
  expect(dialog.textContent).not.toContain('camnc.gcode');
});
