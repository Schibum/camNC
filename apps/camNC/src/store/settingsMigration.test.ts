import { describe, expect, it } from 'vitest';
import { create } from 'zustand';
import { persist, PersistStorage } from 'zustand/middleware';
import { migrateSettings } from './settingsMigration';

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
    const { storage, saved } = storageWith({ state: { toolDiameter: 6, newerField: true }, version: 1 });
    const useSettings = create<Settings>()(
      persist(() => ({ toolDiameter: 3 }), { name: 'settings', storage, migrate: migrateSettings<Settings> })
    );
    expect(useSettings.getState().toolDiameter).toBe(6);
    expect(saved).toHaveLength(1);
  });
});
