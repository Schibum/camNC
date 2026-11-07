import { useStore } from '@/store/store';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { getCncApi } from '@/lib/fluidnc/machine';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { JogPanel } from './controls';

// Once for the whole file: a signal's value can't be spied on twice.
beforeAll(() => {
  vi.spyOn(getCncApi().canJog, 'value', 'get').mockReturnValue(true);
});

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
      jog.mockRestore();
    }
  });

  it('makes one micro step per press with Shift, and does not repeat it', () => {
    const api = getCncApi();
    const jog = vi.spyOn(api, 'jogRelative').mockResolvedValue(undefined as never);
    const cancel = vi.spyOn(api, 'jogCancel').mockImplementation(() => {});
    try {
      render(view());
      fireEvent.click(screen.getByRole('button', { name: 'Keyboard off' }));
      fireEvent.keyDown(window, { key: 'PageUp', shiftKey: true });
      expect(jog).toHaveBeenCalledTimes(1);
      expect(jog.mock.calls[0]![0].z).toBe(0.05);
      fireEvent.keyDown(window, { key: 'PageUp', shiftKey: true, repeat: true });
      expect(jog).toHaveBeenCalledTimes(1);
      fireEvent.keyUp(window, { key: 'PageUp' });
      expect(cancel).not.toHaveBeenCalled();

      jog.mockClear();
      fireEvent.keyDown(window, { key: 'ArrowUp', shiftKey: true });
      const { x = 0, y = 0 } = jog.mock.calls[0]![0];
      expect(Math.hypot(x, y)).toBeCloseTo(0.1);
    } finally {
      jog.mockRestore();
      cancel.mockRestore();
    }
  });

  describe('a jog button', () => {
    const setup = () => {
      const api = getCncApi();
      const jog = vi.spyOn(api, 'jogRelative').mockResolvedValue(undefined as never);
      useStore.getState().setMachinePrefs({ jogStepZ: 1 });
      render(view());
      return { jog, button: screen.getByRole('button', { name: /^Z\+/ }), restore: () => jog.mockRestore() };
    };

    it('moves the usual step on a click, and a micro step with Shift', () => {
      const { jog, button, restore } = setup();
      fireEvent.click(button);
      expect(jog.mock.calls[0]![0].z).toBe(1);
      fireEvent.click(button, { shiftKey: true });
      expect(jog.mock.calls[1]![0].z).toBe(0.05);
      restore();
    });

    it('offers other sizes on a long press, and letting go moves nothing', () => {
      vi.useFakeTimers();
      const { jog, button, restore } = setup();
      try {
        fireEvent.pointerDown(button, { button: 0 });
        act(() => vi.advanceTimersByTime(500));
        fireEvent.pointerUp(button);
        fireEvent.click(button);
        expect(jog).not.toHaveBeenCalled();

        fireEvent.click(screen.getByRole('button', { name: '5 mm' }));
        expect(jog.mock.calls[0]![0].z).toBe(5);
        // Just this move: the usual step stays.
        expect(useStore.getState().machinePrefs.jogStepZ).toBe(1);
      } finally {
        vi.useRealTimers();
        restore();
      }
    });

    it('keeps a size as the usual step when asked to, from a right click too', () => {
      const { jog, button, restore } = setup();
      fireEvent.contextMenu(button);
      fireEvent.click(screen.getByRole('checkbox'));
      fireEvent.click(screen.getByRole('button', { name: '10 mm' }));
      expect(jog.mock.calls[0]![0].z).toBe(10);
      expect(useStore.getState().machinePrefs.jogStepZ).toBe(10);
      restore();
    });

    it('moves nothing on a cancelled long press', () => {
      const { jog, button, restore } = setup();
      fireEvent.contextMenu(button);
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      expect(jog).not.toHaveBeenCalled();
      restore();
    });
  });

  it('picks the step sizes from short lists', () => {
    render(view());
    fireEvent.change(screen.getByRole('combobox', { name: 'XY jog step' }), { target: { value: '50' } });
    expect(useStore.getState().machinePrefs.jogStepXY).toBe(50);
    fireEvent.change(screen.getByRole('combobox', { name: 'Z jog step' }), { target: { value: '5' } });
    expect(useStore.getState().machinePrefs.jogStepZ).toBe(5);
  });
});
