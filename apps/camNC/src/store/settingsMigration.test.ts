import { describe, expect, it } from 'vitest';
import { create } from 'zustand';
import { persist, PersistStorage } from 'zustand/middleware';
import { kSettingsVersion, migrateSettings } from './settingsMigration';

interface Settings {
  toolDiameter: number;
}

function storageWith(value: { state: unknown; version: number }) {
  const saved: unknown[] = [];
  const storage: PersistStorage<Settings> = {
    getItem: () => value as { state: Settings; version: number },
    setItem: (_name, item) => void saved.push(item),
    removeItem: () => {},
  };
  return { storage, saved };
}

describe('migrateSettings', () => {
  it('keeps settings saved by a newer build instead of resetting to the defaults', () => {
    const { storage, saved } = storageWith({ state: { toolDiameter: 6, newerField: true }, version: kSettingsVersion + 1 });
    const useSettings = create<Settings>()(
      persist(() => ({ toolDiameter: 3 }), { name: 'settings', storage, migrate: migrateSettings<Settings> })
    );
    expect(useSettings.getState().toolDiameter).toBe(6);
    expect(saved).toHaveLength(1);
  });

  it('drops the WebUI relay token from v0 settings', () => {
    expect(migrateSettings({ toolDiameter: 6, fluidncToken: 'abc' }, 0)).toEqual({ toolDiameter: 6 });
  });

  it('copies the active camera machine bounds to the machine in v1 settings', () => {
    const bounds = { min: [3, 3], max: [600, 1200] };
    const state = migrateSettings<Record<string, unknown>>({ activeCamId: 'a', camSources: { a: { machineBounds: bounds }, b: {} } }, 1);
    expect(state.machineBounds).toBe(bounds);
  });

  it('keeps machine bounds that are already set', () => {
    const own = { min: [0, 0], max: [1, 1] };
    const state = migrateSettings<Record<string, unknown>>(
      { machineBounds: own, activeCamId: 'a', camSources: { a: { machineBounds: { min: [3, 3], max: [600, 1200] } } } },
      1
    );
    expect(state.machineBounds).toBe(own);
  });
});
