import { useCallback, useEffect, useState } from 'react';

export function useWakeLock() {
  const [wakeLock, setWakeLock] = useState<WakeLockSentinel | null>(null);
  const requestWakeLock = useCallback(() => {
    navigator.wakeLock
      .request('screen')
      .then(wl => {
        console.log('got wake lock');
        setWakeLock(wl);
        wl.addEventListener('release', () => {
          console.log('Screen Wake Lock was released.');
          setWakeLock(null); // Reset wakeLock variable when released
        });
      })
      .catch(err => {
        console.error(err);
      });
    return () => {
      if (wakeLock) {
        wakeLock.release();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    requestWakeLock();
  }, [requestWakeLock]);
  return { wakeLock, requestWakeLock };
}
