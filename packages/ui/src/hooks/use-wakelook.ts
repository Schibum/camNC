import { useEffect } from "react";

export function useWakeLock() {
  useEffect(() => {
    let wakeLock: WakeLockSentinel | null = null;
    navigator.wakeLock.request("screen").then((wl) => {
      console.log("got wake lock");
      wakeLock = wl;
      wakeLock.addEventListener("release", () => {
        console.log("Screen Wake Lock was released.");
        wakeLock = null; // Reset wakeLock variable when released
      });
    });
    return () => {
      if (wakeLock) {
        wakeLock.release();
      }
    };
  }, []);
}
