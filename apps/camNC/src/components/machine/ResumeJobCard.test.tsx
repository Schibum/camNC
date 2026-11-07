import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { getCncApi } from '@/lib/fluidnc/machine';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runResume, prepareResume } from '@/lib/machine/jobs';
import { dismissInterruptedJob } from '@/lib/machine/jobRecovery';
import { ResumeJobCard } from './ResumeJobCard';

const kCamJob = [
  'G21 G90 G17', // 0
  'G0 Z5', // 1
  '(OP 1/1 left: Outline 1 - T1 D=3.175)', // 2
  '(PASS 1/2 Z-1)', // 3
  'G0 X0 Y0', // 4
  'Z1', // 5
  'G1 Z-1 F300', // 6: line 7
  'X20 F1200', // 7
  'Y10', // 8
  '(PASS 2/2 Z-2)', // 9
  'G1 X20 Y10 Z-2 F300', // 10: line 11
  'X0 F1200', // 11: line 12, where it stopped
  'Y0', // 12
  'G0 Z5', // 13
  '',
].join('\n');

const zero = { x: 100, y: 50, z: -20 };
const state = vi.hoisted(() => ({ job: null as unknown }));
const jobFor = (gcode: string) => ({
  reason: 'The machine was reset.',
  record: { gcode, host: 'cnc.local', toolpathName: 'Board' },
  // Stopped half way along line 12 (X20 to X0 at Y10, Z-2).
  progress: { percent: 100, at: 0, wco: zero, mpos: { x: zero.x + 10, y: zero.y + 10, z: zero.z - 2 } },
});

vi.mock('@/lib/fluidnc/machine', () => {
  const v = <T,>(value: T) => ({ value });
  const api = {
    isConnected: v(true),
    state: v('Idle'),
    status: v({ wco: { x: 100, y: 50, z: -20 } }),
    host: v('cnc.local'),
    homed: v(true),
    zZeroedAt: v(null),
    currentOffsetModal: v('G54'),
    ensureTravel: () => {},
    send: vi.fn(() => Promise.resolve()),
    home: () => Promise.resolve(),
    getCurrentZero: () => Promise.resolve(),
  };
  return { getCncApi: () => api };
});
vi.mock('@/lib/machine/jobs', () => ({
  errorText: String,
  kResumeFileName: 'camnc-resume.gcode',
  prepareResume: vi.fn(),
  runResume: vi.fn(),
}));
vi.mock('@/lib/machine/jobRecovery', () => ({
  dismissInterruptedJob: vi.fn(),
  interruptedJob: {
    get value() {
      return state.job;
    },
  },
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  const api = getCncApi();
  api.host.value = 'cnc.local';
  api.status.value = { wco: zero } as typeof api.status.value;
});

const restartLine = () => (screen.getByRole('spinbutton', { name: 'Restart line' }) as HTMLInputElement).value;

describe('ResumeJobCard', () => {
  it.each([
    ['Restore XY and Z', 'G21 G10 L2 P1 X100.000 Y50.000 Z-20.000'],
    ['Restore XY only', 'G21 G10 L2 P1 X100.000 Y50.000'],
  ])('restores saved millimetre offsets with %s', (button, command) => {
    state.job = jobFor(kCamJob);
    const api = getCncApi();
    api.status.value = { wco: { x: 0, y: 0, z: 0 } } as typeof api.status.value;
    render(<ResumeJobCard />);
    fireEvent.click(screen.getByRole('button', { name: button }));
    expect(api.send).toHaveBeenCalledWith(command);
  });

  it('restarts a CAM job at the start of the pass it stopped in, or the previous pass, or where it stopped', () => {
    state.job = jobFor(kCamJob);
    render(<ResumeJobCard />);
    expect(screen.getByText('Stopped in left: Outline 1, pass 2 of 2 (Z-2).')).toBeTruthy();
    expect(restartLine()).toBe('11');
    expect((screen.getByRole('radio', { name: /Start of this pass/ }) as HTMLInputElement).checked).toBe(true);

    fireEvent.click(screen.getByRole('radio', { name: 'Start of the previous pass: pass 1 (line 7)' }));
    expect(restartLine()).toBe('7');

    fireEvent.click(screen.getByRole('radio', { name: 'Where it stopped (line 12)' }));
    expect(restartLine()).toBe('12');
    expect(screen.getByText(/The move the tool was on/)).toBeTruthy();
  });

  it('keeps the exact line for programs without pass markers', () => {
    state.job = jobFor(
      kCamJob
        .split('\n')
        .filter(l => !l.startsWith('('))
        .join('\n')
    );
    render(<ResumeJobCard />);
    expect(screen.queryByRole('radio')).toBeNull();
    expect(screen.queryByText(/Stopped in/)).toBeNull();
    // Line 12 without the three marker lines.
    expect(restartLine()).toBe('9');
  });
});

it('P2 retains Dismiss for an interruption on another controller without offering machine actions', () => {
  state.job = jobFor(kCamJob);
  getCncApi().host.value = 'other.local';
  render(<ResumeJobCard />);
  fireEvent.click(screen.getByRole('button', { name: 'Dismiss interrupted job' }));
  expect(dismissInterruptedJob).toHaveBeenCalledOnce();
  expect(screen.getByText(/^Interrupted job on cnc.local$/)).toBeTruthy();
  expect(screen.queryByRole('button', { name: /Preview and resume/ })).toBeNull();
  expect(screen.queryByRole('button', { name: /Restore XY/ })).toBeNull();
});
it('P1/P9 shows a refused resume and describes its unique execution file', async () => {
  state.job = jobFor(kCamJob);
  vi.mocked(prepareResume).mockReturnValue({
    gcode: kCamJob,
    preambleLines: 1,
    start: { x: 0, y: 0, z: 0 },
    warnings: [],
    travel: null,
  } as ReturnType<typeof prepareResume>);
  vi.mocked(runResume).mockRejectedValue(new Error('The interrupted execution receipt was replaced.'));
  render(<ResumeJobCard />);
  fireEvent.click(screen.getByRole('button', { name: /Preview and resume/ }));
  const dialog = screen.getByRole('alertdialog');
  expect(dialog.textContent).not.toContain('camnc-resume.gcode');
  fireEvent.click(within(dialog).getByRole('button', { name: 'Resume job' }));
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('receipt was replaced'));
});
