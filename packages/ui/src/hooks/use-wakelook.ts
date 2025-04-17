import { useCallback, useEffect, useState } from "react";

export function useWakeLock() {
  const [wakeLock, setWakeLock] = useState<WakeLockSentinel | null>(null);
  const requestWakeLock = useCallback(() => {
    navigator.wakeLock.request("screen").then((wl) => {
      console.log("got wake lock");
      setWakeLock(wl);
      wl.addEventListener("release", () => {
        console.log("Screen Wake Lock was released.");
        setWakeLock(null); // Reset wakeLock variable when released
      });
    });
    return () => {
      if (wakeLock) {
        wakeLock.release();
      }
    };
  }, []);
  useEffect(() => {
    requestWakeLock();
  }, [requestWakeLock]);
  return { wakeLock, requestWakeLock };
}
