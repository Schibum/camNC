import { useStore } from '@/store/store';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { getCncApi } from '@/lib/fluidnc/machine';
import { afterEach, describe, expect, it, vi } from 'vitest';
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

  it('never jogs from arrow keys meant for the step list', () => {
    const api = getCncApi();
    const canJog = vi.spyOn(api.canJog, 'value', 'get').mockReturnValue(true);
    const jog = vi.spyOn(api, 'jogRelative').mockResolvedValue(undefined as never);
    try {
      render(view());
      fireEvent.click(screen.getByRole('button', { name: 'Keyboard off' }));
      fireEvent.keyDown(screen.getByRole('combobox', { name: 'XY jog step' }), { key: 'ArrowUp' });
      expect(jog).not.toHaveBeenCalled();
      // Elsewhere the same key does jog: that's what the toggle is for.
      fireEvent.keyDown(window, { key: 'ArrowUp' });
      expect(jog).toHaveBeenCalledTimes(1);
      fireEvent.keyUp(window, { key: 'ArrowUp' });
    } finally {
      canJog.mockRestore();
      jog.mockRestore();
    }
  });

  it('picks the step sizes from short lists', () => {
    render(view());
    fireEvent.change(screen.getByRole('combobox', { name: 'XY jog step' }), { target: { value: '50' } });
    expect(useStore.getState().machinePrefs.jogStepXY).toBe(50);
    fireEvent.change(screen.getByRole('combobox', { name: 'Z jog step' }), { target: { value: '5' } });
    expect(useStore.getState().machinePrefs.jogStepZ).toBe(5);
  });
});
