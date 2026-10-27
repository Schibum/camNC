import superjson from 'superjson';
// Registers the superjson types for three.js values used in the settings.
import './store-storage';
import { kSettingsVersion, migrateSettings } from './settingsMigration';
import { ICamSource, useStore } from './store';

/** Marks a camNC settings backup file, and its format version. */
const kBackupFormat = 'camnc-settings-backup';

type PersistedSettings = Partial<ReturnType<typeof useStore.getState>>;

/** What a backup file holds, as `parseSettingsBackup` reads it. */
export type SettingsBackup =
  | { kind: 'settings'; settings: PersistedSettings }
  /** A single camera exported from the old Debug page (`cam-source.json`). */
  | { kind: 'camera'; camera: ICamSource };

/** All saved settings (cameras with their calibration, machine connection and bounds, macros, ...) as a file. */
export function exportSettingsBackup(): string {
  const { partialize } = useStore.persist.getOptions();
  const settings = partialize!(useStore.getState()) as PersistedSettings;
  return superjson.stringify({ format: kBackupFormat, version: kSettingsVersion, settings });
}

export function backupFileName(date = new Date()) {
  return `camnc-settings-${date.toISOString().slice(0, 10)}.json`;
}

function isCamSource(value: unknown): value is ICamSource {
  const cam = value as Partial<ICamSource> | null;
  return !!cam && typeof cam.url === 'string' && Array.isArray(cam.maxResolution);
}

/** Reads a backup file. Throws an Error with a message for the user if it is not one. */
export function parseSettingsBackup(text: string): SettingsBackup {
  let data: unknown;
  try {
    data = superjson.parse(text);
  } catch {
    throw new Error('This file is not a camNC settings backup.');
  }
  const backup = data as { format?: string; version?: number; settings?: unknown } | null;
  if (backup?.format === kBackupFormat && backup.settings && typeof backup.settings === 'object') {
    const settings = migrateSettings<PersistedSettings>(backup.settings, backup.version ?? 0);
    return { kind: 'settings', settings };
  }
  if (isCamSource(data)) return { kind: 'camera', camera: data };
  throw new Error('This file is not a camNC settings backup.');
}

/** The cameras in a backup, for showing what restoring it brings. */
export function backupCameras(backup: SettingsBackup): ICamSource[] {
  return backup.kind === 'camera' ? [backup.camera] : Object.values(backup.settings.camSources ?? {});
}

/**
 * Restores a backup. A full backup replaces the saved settings; a single camera is added next to the existing ones.
 * Either way the restored camera becomes the active one, keeping its calibration and markers.
 */
export function restoreSettingsBackup(backup: SettingsBackup) {
  if (backup.kind === 'camera') {
    useStore.getState().addCamSource(backup.camera.name, backup.camera);
    return;
  }
  const { partialize } = useStore.persist.getOptions();
  const known = Object.keys(partialize!(useStore.getState()) as object);
  const settings = Object.fromEntries(Object.entries(backup.settings).filter(([key]) => known.includes(key)));
  useStore.setState(settings);
}
