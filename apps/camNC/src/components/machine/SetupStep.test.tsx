import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { SetupStep, type StepState } from './SetupStep';

afterEach(cleanup);

const step = (state: StepState) => (
  <SetupStep state={state} title="Zero" summary="XY = toolpath · Z set">
    <p>Probe Z</p>
  </SetupStep>
);

describe('SetupStep', () => {
  it('a step to do shows what to do; once done it folds to its title, and unfolds on a click', () => {
    const { rerender } = render(step('todo'));
    const region = () => within(screen.getByRole('region', { name: 'Zero' }));
    expect(region().getByText('Probe Z')).toBeTruthy();
    rerender(step('done'));
    expect(region().queryByText('Probe Z')).toBeNull();
    expect(region().getByText('XY = toolpath · Z set')).toBeTruthy();
    fireEvent.click(region().getByRole('button', { expanded: false }));
    expect(region().getByText('Probe Z')).toBeTruthy();
  });

  it('a step that needs doing again opens', () => {
    const { rerender } = render(step('done'));
    rerender(step('warn'));
    expect(screen.getByText('Probe Z')).toBeTruthy();
  });
});
