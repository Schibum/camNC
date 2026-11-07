import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MachineBoundsForm } from './MachineBoundsForm';

vi.mock('@/lib/fluidnc/machine', () => ({ getCncApi: () => ({ isConnected: { value: true } }) }));
vi.mock('@/lib/fluidnc/fluidnc-settings', () => ({ getFluidSettingsBounds: vi.fn() }));
vi.mock('@/store/store', () => ({
  useStore: (selector: (state: object) => unknown) => selector({ setMachineBounds: vi.fn() }),
  useMachineBoundsOrNull: () => null,
}));

afterEach(cleanup);

describe('MachineBoundsForm', () => {
  it('leaves Enter in a field to the submit button, not to reading the controller', () => {
    render(<MachineBoundsForm onConfirmed={() => {}} />);
    expect(screen.getByRole('button', { name: 'Read FluidNC Settings' }).getAttribute('type')).toBe('button');
    expect(screen.getByRole('button', { name: 'Confirm' }).getAttribute('type')).toBe('submit');
  });
});
