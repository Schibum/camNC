import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DemoHeaderMark } from './DemoHeaderMark';

const action = vi.hoisted(() => ({
  demo: true,
  rehearsalId: null as string | null,
  exitDemo: vi.fn(),
  leaveRehearsal: vi.fn(),
}));

vi.mock('./demo-mode', () => ({
  exitDemo: action.exitDemo,
  getRehearsalId: () => action.rehearsalId,
  isDemoMode: () => action.demo,
}));
vi.mock('../rehearsal/rehearsal', () => ({ leaveRehearsal: action.leaveRehearsal }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  action.demo = true;
  action.rehearsalId = null;
});

describe('DemoHeaderMark', () => {
  it('stays out of the page outside demo mode', () => {
    action.demo = false;
    expect(render(<DemoHeaderMark />).container.textContent).toBe('');
  });

  it('identifies local demo projects without claiming machine settings are saved, and leaves it', () => {
    render(<DemoHeaderMark />);
    expect(screen.getByText('Demo · local projects')).toBeTruthy();
    expect(screen.queryByText(/not saved/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Exit' }));
    expect(action.exitDemo).toHaveBeenCalledWith('/');
  });

  it('returns a rehearsal to its CAM job', () => {
    action.rehearsalId = 'r1';
    render(<DemoHeaderMark />);
    expect(screen.getByText(/Rehearsal · not saved/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Return to CAM' }));
    expect(action.leaveRehearsal).toHaveBeenCalledOnce();
    expect(action.exitDemo).not.toHaveBeenCalled();
  });
});
