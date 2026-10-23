/**
 * Settings saved by a newer build carry a higher version than this one. Keep them as they are instead of
 * discarding them: the fields this build knows stay compatible, and unknown ones are dropped on its next save.
 * Without a migrate function, zustand would start from the defaults, and the next change would save those
 * over the user's synced settings.
 */
export function migrateSettings<T>(persistedState: unknown): T {
  return persistedState as T;
}
