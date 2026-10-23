import { setSettingsAuth } from '@/lib/settings-sync/settings-api';
import superjson from 'superjson';
import { Vector2 } from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createStorage, setServerSettings } from './store-storage';

const value = { state: { toolDiameter: 6, offset: new Vector2(1, 2) }, version: 1 };

afterEach(() => {
  setServerSettings(null);
  setSettingsAuth(null);
  localStorage.removeItem('settings');
  vi.restoreAllMocks();
});

describe('createStorage', () => {
  it('prefers settings loaded from the server over localStorage', () => {
    localStorage.setItem('settings', superjson.stringify({ state: { toolDiameter: 3 }, version: 1 }));
    setServerSettings(superjson.serialize(value));
    expect(createStorage().getItem('settings')).toEqual(value);
  });

  it('falls back to localStorage when signed out', () => {
    localStorage.setItem('settings', superjson.stringify(value));
    expect(createStorage().getItem('settings')).toEqual(value);
  });

  it('saves locally and uploads to the settings API when signed in', async () => {
    const fetchMock = vi.spyOn(window, 'fetch').mockResolvedValue(new Response(null, { status: 204 }));
    setSettingsAuth(async () => 'token');
    await createStorage().setItem('settings', value as any);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(superjson.parse(localStorage.getItem('settings')!)).toEqual(value);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/settings');
    expect(init?.method).toBe('PUT');
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer token');
    expect(superjson.deserialize(JSON.parse(init!.body as string))).toEqual(value);
  });

  it('does not call the API when signed out', async () => {
    const fetchMock = vi.spyOn(window, 'fetch');
    await createStorage().setItem('settings', value as any);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(localStorage.getItem('settings')).not.toBeNull();
  });
});
