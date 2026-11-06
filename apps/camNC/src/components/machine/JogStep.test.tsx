import { useStore } from '@/store/store';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { JogPanel } from './controls';

const keyboardJog = () => useStore.getState().machinePrefs.keyboardJog;
const view = () => <JogPanel />;

afterEach(() => {
  cleanup();
  useStore.getState().setMachinePrefs({ keyboardJog: false });
});

describe('the jog panel, always in view while preparing', () => {
  it('turns keyboard jog off when it appears and when it goes, whatever was saved', () => {
    useStore.getState().setMachinePrefs({ keyboardJog: true });
    const { unmount } = render(view());
    expect(keyboardJog()).toBe(false);
    const toggle = screen.getByRole('button', { name: 'Keyboard off' });
    expect(toggle.getAttribute('aria-pressed')).toBe('false');

    fireEvent.click(toggle);
    expect(keyboardJog()).toBe(true);
    expect(screen.getByRole('button', { name: 'Keyboard on' }).getAttribute('aria-pressed')).toBe('true');

    unmount();
    expect(keyboardJog()).toBe(false);
  });

  it('picks the step sizes from short lists', () => {
    render(view());
    fireEvent.change(screen.getByRole('combobox', { name: 'XY jog step' }), { target: { value: '50' } });
    expect(useStore.getState().machinePrefs.jogStepXY).toBe(50);
    fireEvent.change(screen.getByRole('combobox', { name: 'Z jog step' }), { target: { value: '5' } });
    expect(useStore.getState().machinePrefs.jogStepZ).toBe(5);
  });
});
