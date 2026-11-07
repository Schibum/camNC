import { getCncApi } from '@/lib/fluidnc/machine';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { RunFooter } from './RunFooter';

beforeAll(() => {
  const api = getCncApi();
  vi.spyOn(api.isConnected, 'value', 'get').mockReturnValue(true);
  vi.spyOn(api.state, 'value', 'get').mockReturnValue('Idle');
});

afterEach(() => {
  cleanup();
  const api = getCncApi();
  api.homed.value = false;
  api.zZeroedAt.value = null;
});

// The test build has no signals transform, unlike the app: render again to see a signal's new value.
const view = () => <RunFooter />;

describe('the run footer', () => {
  it('its main button is whatever is next: home, probe Z, run', () => {
    const api = getCncApi();
    const { rerender } = render(view());
    expect(screen.getByRole('button', { name: 'Home machine' })).toBeTruthy();
    api.homed.value = true;
    rerender(view());
    expect(screen.getByRole('button', { name: 'Probe Z' })).toBeTruthy();
    api.zZeroedAt.value = Date.now();
    rerender(view());
    expect(screen.getByRole('button', { name: 'Run job' })).toBeTruthy();
  });

  it('never starts a probe without asking for the plate', async () => {
    const api = getCncApi();
    api.homed.value = true;
    const probe = vi.spyOn(api, 'probeZ').mockResolvedValue(undefined);
    render(view());
    fireEvent.click(await screen.findByRole('button', { name: 'Probe Z' }));
    expect(probe).not.toHaveBeenCalled();
    expect(await screen.findByRole('alertdialog')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Probe' }));
    await waitFor(() => expect(probe).toHaveBeenCalledOnce());
    probe.mockRestore();
  });

  it('skips a step marked as already done before, and can take that back', async () => {
    const api = getCncApi();
    const { rerender } = render(view());
    const pick = async (trigger: string, item: string) => {
      fireEvent.keyDown(screen.getByRole('button', { name: trigger, hidden: true }), { key: 'Enter' });
      fireEvent.click(await screen.findByRole('menuitem', { name: item }));
      rerender(view());
    };
    await pick('Home: not done, options', 'Already done before');
    expect(api.homed.value).toBe(true);
    expect(screen.getByRole('button', { name: 'Probe Z', hidden: true })).toBeTruthy();

    await pick('Z: not done, options', 'Already done before');
    expect(api.zZeroedAt.value).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Run job', hidden: true })).toBeTruthy();

    await pick('Z: done, options', 'Mark as not done');
    expect(api.zZeroedAt.value).toBeNull();
    expect(screen.getByRole('button', { name: 'Probe Z', hidden: true })).toBeTruthy();
  });
});
