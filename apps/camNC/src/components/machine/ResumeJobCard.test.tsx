import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
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
    send: () => Promise.resolve(),
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
  dismissInterruptedJob: () => {},
  interruptedJob: {
    get value() {
      return state.job;
    },
  },
}));

afterEach(cleanup);

const restartLine = () => (screen.getByRole('spinbutton', { name: 'Restart line' }) as HTMLInputElement).value;

describe('ResumeJobCard', () => {
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
