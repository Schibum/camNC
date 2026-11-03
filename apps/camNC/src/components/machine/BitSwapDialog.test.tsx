import { signal } from '@preact/signals-react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BitSwapDialog } from './BitSwapDialog';
import { RunningView } from './RunningView';

const api = vi.hoisted(() => ({
  status: null as unknown as { value: { state: string; subState?: number } | null },
  state: null as unknown as { value: string | null },
  jobProgress: null as unknown as { value: { percent: number; file: string } | null },
  jobStartedAt: { value: null },
  lastMessage: { value: null },
  resume: vi.fn(),
  feedHold: vi.fn(),
}));
const jobs = vi.hoisted(() => ({ stopJob: vi.fn() }));
const store = vi.hoisted(() => ({ toolpath: null as { gcode: string } | null }));

vi.mock('@/lib/fluidnc/machine', () => ({ getCncApi: () => api }));
vi.mock('@/lib/machine/jobs', () => ({
  errorText: (err: unknown) => String(err),
  isCamncJobFile: (file: string) => file.endsWith('camnc.gcode'),
  stopJob: jobs.stopJob,
}));
vi.mock('@/store/store', () => ({ useStore: (selector: (state: typeof store) => unknown) => selector(store) }));
vi.mock('./controls', () => ({ OverridesPanel: () => null, PositionLine: () => null }));
vi.mock('./AlarmCard', () => ({ AlarmCard: () => null }));
vi.mock('./SetupView', () => ({ Section: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));

const swap = {
  from: { tool: 1, diameter: 3.175, description: 'flat end mill' },
  to: { tool: 2, diameter: 6, description: 'flat end mill' },
  rpm: 15000,
};

function hold(subState = 0) {
  api.status = signal({ state: 'Hold', subState });
  api.state = signal('Hold');
}

afterEach(() => {
  cleanup();
  api.resume.mockReset();
  jobs.stopJob.mockReset();
});

const continueButton = () => screen.getByRole('button', { name: 'Continue' });

describe('BitSwapDialog', () => {
  it('lists the steps for the swap and enables Continue once all are ticked', async () => {
    hold();
    api.resume.mockResolvedValue(undefined);
    render(<BitSwapDialog swap={swap} line={42} zOnSpoilboard open onOpenChange={() => {}} />);
    expect(screen.getByRole('heading').textContent).toBe('Swap bit: 3.175 mm → 6 mm flat');
    const dialog = screen.getByTestId('bit-swap-dialog').textContent!;
    expect(dialog).toContain('1. Switch the router off.');
    expect(dialog).toContain('2. Put in the 6 mm flat end mill (T2).');
    expect(dialog).toContain('3. Zero Z on the spoilboard.');
    expect(dialog).toContain('4. Switch the router on (15,000 rpm).');
    expect(dialog).toContain('XY stays where it is. Do not move the board.');

    const boxes = screen.getAllByRole('checkbox');
    expect(boxes).toHaveLength(4);
    for (const box of boxes.slice(0, 3)) fireEvent.click(box);
    expect(continueButton()).toHaveProperty('disabled', true);
    fireEvent.click(boxes[3]!);
    expect(continueButton()).toHaveProperty('disabled', false);
    fireEvent.click(continueButton());
    await waitFor(() => expect(api.resume).toHaveBeenCalledTimes(1));
  });

  it('waits for the hold to finish and stops the job on Stop', () => {
    hold(1);
    render(<BitSwapDialog swap={swap} line={42} zOnSpoilboard={false} open onOpenChange={() => {}} />);
    expect(screen.getByTestId('bit-swap-dialog').textContent).toContain('3. Zero Z where you zeroed the first bit.');
    for (const box of screen.getAllByRole('checkbox')) fireEvent.click(box);
    expect(continueButton()).toHaveProperty('disabled', true);
    fireEvent.click(screen.getByRole('button', { name: 'Stop job' }));
    expect(jobs.stopJob).toHaveBeenCalled();
  });
});

describe('RunningView at a pause', () => {
  const gcode = [
    '( Tools Table:)',
    '(  T1 D=3.175 CR=0 - ZMIN=-0.3 - flat end mill )',
    '(  T2 D=6 CR=0 - ZMIN=-0.3 - flat end mill )',
    'G21 G90 G94 G17',
    'M0 (MSG Insert T1 D=3.175, turn ON spindle 15000RPM)',
    '(OP 1/2 Slot - T1 D=3.175)',
    ...Array.from({ length: 200 }, (_, i) => `G1 X${i} Y1 F1200`),
    'M0 (MSG Spindle OFF. Change to T2 D=6, re-zero Z, spindle ON 15000RPM)',
    '(OP 2/2 Outline - T2 D=6)',
    ...Array.from({ length: 200 }, (_, i) => `G1 X${i} Y2 F1200`),
  ].join('\n');
  const percentAfter = (text: string) => {
    const end = gcode.indexOf('\n', gcode.indexOf(text)) + 1;
    return (100 * end) / gcode.length;
  };

  it('opens the bit swap at a bit change, and can open it again after closing', () => {
    hold();
    store.toolpath = { gcode };
    api.jobProgress = signal({ percent: percentAfter('Change to T2'), file: '/sd/camnc.gcode' });
    render(<RunningView />);
    expect(screen.getByRole('heading').textContent).toBe('Swap bit: 3.175 mm → 6 mm flat');
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByTestId('bit-swap-dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Bit swap steps' }));
    expect(screen.getByTestId('bit-swap-dialog')).toBeTruthy();
  });

  it('keeps the plain explanation at other pauses', () => {
    hold();
    store.toolpath = { gcode };
    api.jobProgress = signal({ percent: percentAfter('Insert T1'), file: '/sd/camnc.gcode' });
    render(<RunningView />);
    expect(screen.queryByTestId('bit-swap-dialog')).toBeNull();
    expect(screen.getByTestId('hold-explanation').textContent).toContain('Insert T1 D=3.175');
  });
});
