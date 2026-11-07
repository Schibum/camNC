import { signal } from '@preact/signals-react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useCamMachine, type QueueEntry } from './camMachine';
import type { ManufacturingSnapshot } from './manufacturingSnapshot';
import { useStore } from '@/store/store';
import { CamBedEditor } from './CamBedEditor';
const h = vi.hoisted(() => ({ api: null as unknown as import('@/lib/fluidnc/cnc-api').CncApi, entry: null as unknown as QueueEntry }));
vi.mock('@/lib/fluidnc/machine', () => ({ getCncApi: () => h.api, getExistingCncApi: () => h.api }));
vi.mock('@/lib/fluidnc/machineInstance', () => ({ getExistingCncApi: () => h.api }));
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => vi.fn() }));
vi.mock('./useMachineQueue', () => ({
  useMachineQueue: () => ({ current: h.entry, queue: [h.entry], done: [], instances: [], nestBit: 3, updateBoard: vi.fn() }),
}));
afterEach(() => {
  cleanup();
  useCamMachine.setState(useCamMachine.getInitialState(), true);
});
it('P10 describes finished setup review rather than claiming the idle controller is running', () => {
  useStore.setState(useStore.getInitialState(), true);
  useCamMachine.setState(useCamMachine.getInitialState(), true);
  h.api = { jobProgress: signal(null), jobStartedAt: signal(null) } as unknown as typeof h.api;
  h.entry = {
    key: 'board:bit:0',
    kind: 'pending',
    doneId: 'd',
    board: { board: { id: 'board', name: 'A', size: { fit: true } }, nest: { board: { w: 100, h: 80 }, placements: [] }, request: null },
  } as unknown as QueueEntry;
  useCamMachine.setState({
    jobId: 'job',
    active: h.entry.key,
    runReview: 'finished',
    runSnapshot: {} as ManufacturingSnapshot,
    overlay: { boardId: 'board', w: 100, h: 80, rotationDeg: 0 },
  });
  render(<CamBedEditor />);
  const toolbar = screen.getByRole('toolbar', { name: 'Edit board A' });
  expect(toolbar.textContent).not.toContain('Locked while the program runs');
  expect(toolbar.textContent).toMatch(/finished.*review|review.*finished/i);
});
