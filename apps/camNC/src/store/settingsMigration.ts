/**
 * Version of the persisted settings.
 * v1: the WebUI extension relay (`fluidncToken`) was replaced by a direct connection (`machine`).
 * v2: machine bounds moved from the camera source to the machine (`machineBounds`), so they are known without a camera.
 */
export const kSettingsVersion = 2;

/**
 * Migrates settings saved with an older version. Settings saved by a newer build carry a higher version than this
 * one; they are kept as they are instead of discarded: the fields this build knows stay compatible, and unknown ones
 * are dropped on its next save. Without a migrate function, zustand would start from the defaults, and the next
 * change would save those over the user's synced settings.
 */
export function migrateSettings<T>(persistedState: unknown, version: number): T {
  const state = (persistedState ?? {}) as Record<string, unknown>;
  if (version < 1) delete state.fluidncToken;
  if (version < 2 && !state.machineBounds) {
    const cams = state.camSources as Record<string, { machineBounds?: unknown }> | undefined;
    const active = typeof state.activeCamId === 'string' ? cams?.[state.activeCamId] : undefined;
    if (active?.machineBounds) state.machineBounds = active.machineBounds;
  }
  return state as T;
}
