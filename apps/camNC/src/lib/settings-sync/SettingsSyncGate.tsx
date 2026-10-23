import { DefaultLoadingOverlay } from '@/components/DefaultLoadingOverlay';
import { setServerSettings } from '@/store/store-storage';
import { useStore } from '@/store/store';
import { useAuth } from '@clerk/clerk-react';
import { toast } from '@wbcnc/ui/components/sonner';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import superjson from 'superjson';
import { fetchUserSettings, saveUserSettings, setSettingsAuth } from './settings-api';

/**
 * Loads the signed-in user's settings from the server into the store before rendering the app.
 * Signed-out users keep using the settings from localStorage. `onReady` runs once, after the first
 * sync and before the children render.
 */
export function SettingsSyncGate({ children, onReady }: { children: ReactNode; onReady?: () => void }) {
  const { isLoaded, isSignedIn, userId, getToken } = useAuth();
  const [syncedUserId, setSyncedUserId] = useState<string | null | undefined>(undefined);
  const isFirstSync = useRef(true);
  const readyCalled = useRef(false);

  useEffect(() => {
    if (!isLoaded) return;
    const currentUserId = isSignedIn ? userId : null;
    if (currentUserId === syncedUserId) return;
    setSettingsAuth(currentUserId ? () => getToken() : null);
    if (!currentUserId) {
      setSyncedUserId(null);
      isFirstSync.current = false;
      return;
    }
    let cancelled = false;
    syncSettings({ uploadLocal: !isFirstSync.current })
      .catch(err => {
        console.error(err);
        toast.error('Could not load your saved settings, using the settings on this device.');
      })
      .finally(() => {
        if (cancelled) return;
        isFirstSync.current = false;
        setSyncedUserId(currentUserId);
      });
    return () => {
      cancelled = true;
    };
  }, [isLoaded, isSignedIn, userId, getToken, syncedUserId]);

  if (syncedUserId === undefined) return <DefaultLoadingOverlay />;
  if (!readyCalled.current) {
    readyCalled.current = true;
    onReady?.();
  }
  return children;
}

/**
 * Applies the server copy if there is one. Otherwise, on sign-in during the session, uploads the
 * settings from this device so they are kept for the account.
 */
async function syncSettings({ uploadLocal }: { uploadLocal: boolean }) {
  const serialized = await fetchUserSettings();
  if (serialized) {
    setServerSettings(serialized);
    await useStore.persist.rehydrate();
  } else if (uploadLocal) {
    const { partialize, version } = useStore.persist.getOptions();
    const state = useStore.getState();
    await saveUserSettings(superjson.serialize({ state: partialize ? partialize(state) : state, version: version ?? 0 }));
  }
}
