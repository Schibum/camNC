// Client for the settings API served by the camNC Worker (worker/index.ts).
import { isDemoMode } from '@/lib/demo/demo-mode';

type TokenGetter = () => Promise<string | null>;

let getToken: TokenGetter | null = null;

/** Set by SettingsSyncGate while a user is signed in, null otherwise. */
export function setSettingsAuth(getter: TokenGetter | null) {
  getToken = getter;
}

async function authHeaders(): Promise<Record<string, string> | null> {
  // Last line of defence: the demo must never read or write a real user's settings.
  if (isDemoMode()) return null;
  const token = await getToken?.();
  return token ? { Authorization: `Bearer ${token}` } : null;
}

/** Returns the signed-in user's serialized settings, or null if signed out or none saved yet. */
export async function fetchUserSettings(): Promise<unknown | null> {
  const headers = await authHeaders();
  if (!headers) return null;
  const resp = await fetch('/api/settings', { headers });
  if (resp.status === 404) return null;
  if (!resp.ok) throw new Error(`Loading settings failed: ${resp.status}`);
  const body = (await resp.json()) as { settings: unknown };
  return body.settings;
}

/** Saves serialized settings for the signed-in user, no-op when signed out. */
export async function saveUserSettings(settings: unknown) {
  const headers = await authHeaders();
  if (!headers) return;
  const resp = await fetch('/api/settings', {
    method: 'PUT',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify(settings),
  });
  if (!resp.ok) throw new Error(`Saving settings failed: ${resp.status}`);
}
