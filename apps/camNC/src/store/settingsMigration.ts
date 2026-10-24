/**
 * Version of the persisted settings.
 * v1: the WebUI extension relay (`fluidncToken`) was replaced by a direct connection (`machine`).
 */
export const kSettingsVersion = 1;

/**
 * Migrates settings saved with an older version. Settings saved by a newer build carry a higher version than this
 * one; they are kept as they are instead of discarded: the fields this build knows stay compatible, and unknown ones
 * are dropped on its next save. Without a migrate function, zustand would start from the defaults, and the next
 * change would save those over the user's synced settings.
 */
export function migrateSettings<T>(persistedState: unknown, version: number): T {
  const state = (persistedState ?? {}) as Record<string, unknown>;
  if (version < 1) delete state.fluidncToken;
  return state as T;
}
