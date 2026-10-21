import { useCallback, useEffect, useRef, useState } from 'react';

/** Keeps the screen awake while the component is mounted (where the Screen Wake Lock API is available). */
export function useWakeLock() {
  const [wakeLock, setWakeLock] = useState<WakeLockSentinel | null>(null);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  const unmountedRef = useRef(false);
  const requestWakeLock = useCallback(() => {
    // Unsupported browsers and insecure origins don't have navigator.wakeLock.
    if (!('wakeLock' in navigator)) return;
    navigator.wakeLock
      .request('screen')
      .then(wl => {
        if (unmountedRef.current) {
          // Granted after unmount; nobody would release it otherwise.
          wl.release().catch(console.error);
          return;
        }
        console.log('got wake lock');
        wakeLockRef.current = wl;
        setWakeLock(wl);
        wl.addEventListener('release', () => {
          console.log('Screen Wake Lock was released.');
          if (wakeLockRef.current === wl) wakeLockRef.current = null;
          setWakeLock(null); // Reset wakeLock variable when released
        });
      })
      .catch(err => {
        console.error(err);
      });
  }, []);
  useEffect(() => {
    unmountedRef.current = false;
    requestWakeLock();
    return () => {
      unmountedRef.current = true;
      wakeLockRef.current?.release().catch(console.error);
      wakeLockRef.current = null;
    };
  }, [requestWakeLock]);
  return { wakeLock, requestWakeLock };
}
