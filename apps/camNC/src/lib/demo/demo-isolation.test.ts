import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setSettingsAuth, fetchUserSettings, saveUserSettings } from '@/lib/settings-sync/settings-api';
import { createStorage } from '@/store/store-storage';
import { getActiveCamSource, getMachineBounds, useStore } from '@/store/store';
import { isDemoMode, setDemoModeForTest } from './demo-mode';
import { applyDemoPreset, kDemoMachineHost } from './demo-preset';

const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));

beforeEach(() => {
  localStorage.clear();
  fetchMock.mockClear();
  vi.stubGlobal('fetch', fetchMock);
  setSettingsAuth(async () => 'token');
});

afterEach(() => {
  setDemoModeForTest(false);
  setSettingsAuth(null);
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe('demo mode isolation', () => {
  it('is off unless switched on', () => {
    expect(isDemoMode()).toBe(false);
    setDemoModeForTest(true);
    expect(isDemoMode()).toBe(true);
  });

  it('ignores saved settings and never writes them, locally or to the account', async () => {
    setDemoModeForTest(true);
    localStorage.setItem('settings', JSON.stringify({ json: { state: { toolDiameter: 99 } } }));
    const storage = createStorage();

    expect(await storage.getItem('settings')).toBeNull();
    await storage.setItem('settings', { state: { toolDiameter: 1 }, version: 1 });
    await storage.removeItem('settings');
    await new Promise(resolve => setTimeout(resolve, 700));

    expect(localStorage.getItem('settings')).toContain('"toolDiameter":99');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses to load or save account settings even when signed in', async () => {
    setDemoModeForTest(true);
    expect(await fetchUserSettings()).toBeNull();
    await saveUserSettings({ anything: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('still talks to the settings API outside the demo', async () => {
    await saveUserSettings({ anything: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('demo preset', () => {
  it('provides a calibrated camera, the machine and a toolpath', () => {
    applyDemoPreset('https://example.test');
    const state = useStore.getState();
    const camera = getActiveCamSource()!;
    expect(camera.url).toBe('https://example.test/demo/demo-clip.mp4');
    expect(camera.maxResolution).toEqual([1280, 960]);
    expect(camera.calibration && camera.extrinsics && camera.markerPositions).toBeTruthy();
    expect(camera.markerPosInCam).toHaveLength(16);
    expect(state.machine?.host).toBe(kDemoMachineHost);
    expect(state.toolpath?.gcode).toContain('G3');
    expect(state.toolpathName).toMatch(/demo/);
    expect(state.toolDiameter).toBe(6);
    const bounds = state.toolpath!.getBounds();
    expect(bounds.max.x - bounds.min.x).toBeGreaterThan(190);
  });

  it('leaves out the camera for the camera-free demo, keeping the machine bounds', () => {
    applyDemoPreset('https://example.test', { camera: false });
    expect(getActiveCamSource()).toBeNull();
    expect(useStore.getState().camSources).toEqual({});
    expect(getMachineBounds()?.max.toArray()).toEqual([621, 1241]);
    expect(useStore.getState().machine?.host).toBe(kDemoMachineHost);
  });
});
