import { describe, expect, it } from 'vitest';
import { create } from 'zustand';
import { persist, PersistStorage } from 'zustand/middleware';
import { migrateSettings } from './settingsMigration';

function storageWith(value: { state: unknown; version: number }) {
  const saved: unknown[] = [];
  const storage: PersistStorage<unknown> = {
    getItem: () => value,
    setItem: (_name, item) => void saved.push(item),
    removeItem: () => {},
  };
  return { storage, saved };
}

describe('migrateSettings', () => {
  it('keeps settings saved by a newer build instead of resetting to the defaults', () => {
    const { storage, saved } = storageWith({ state: { toolDiameter: 6, newerField: true }, version: 1 });
    const useSettings = create<{ toolDiameter: number }>()(
      persist(() => ({ toolDiameter: 3 }), { name: 'settings', storage: storage as PersistStorage<{ toolDiameter: number }>, migrate: migrateSettings })
    );
    expect(useSettings.getState().toolDiameter).toBe(6);
    expect(saved).toHaveLength(1);
  });
});
