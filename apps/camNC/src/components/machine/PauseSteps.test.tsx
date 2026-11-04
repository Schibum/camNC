import { useCamMachine } from '@/cam/machine/camMachine';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { pauseSteps } from '@/lib/machine/pauseSteps';
import { PauseSteps } from './PauseSteps';

afterEach(() => {
  cleanup();
  useCamMachine.setState({ overlay: null });
});

describe('PauseSteps', () => {
  it('a take-out pause says what to take out, what to hold down next, then Resume', () => {
    const { steps } = pauseSteps({ kind: 'take-out', n: 2, of: 5, part: 'Part 1b', next: 'Part 2' });
    expect(steps.map(s => s.title)).toEqual([
      'Router off, if you switch it by hand',
      'Take out Part 1b',
      'Hold down Part 2',
      'Router on, then Resume',
    ]);
    expect(steps[2]!.hold).toBe(true);
  });

  it('hands go near the bit only after the router is off: take-out and tab pauses say so first', () => {
    for (const m of [
      { kind: 'tab', n: 1, of: 3, part: 'side' },
      { kind: 'take-out', n: 1, of: 2, part: 'a', next: 'b' },
    ] as const)
      expect(pauseSteps(m).steps[0]!.title).toBe('Router off, if you switch it by hand');
  });

  it('the last take-out has nothing to hold down', () => {
    const { steps } = pauseSteps({ kind: 'take-out', n: 5, of: 5, part: 'Part 4' });
    expect(steps.map(s => s.title)).toEqual(['Router off, if you switch it by hand', 'Take out Part 4', 'Resume']);
  });

  it('shows the parts as chips when the machine view knows them, the line number only in small print', () => {
    const at = { x: 0, y: 0 };
    useCamMachine.setState({
      overlay: {
        w: 100,
        h: 100,
        rotationDeg: 0,
        freeParts: ['Part 1a', 'Part 1b', 'Part 2', 'Part 3', 'Part 4'].map(name => ({ name, at })),
      },
    });
    render(<PauseSteps marker={{ kind: 'take-out', n: 2, of: 5, part: 'Part 1b', next: 'Part 2' }} line={65} />);
    expect(screen.getByLabelText('Parts').textContent).toBe('Part 1aPart 1bPart 2Part 3Part 42 of 5');
    expect(screen.getByTestId('pause-steps').textContent).toMatch(/Hold down Part 2/);
    expect(screen.getByText('M0 · line 65')).toBeTruthy();
    expect(screen.getByTestId('pause-steps').textContent).not.toMatch(/program pause/);
  });
});
