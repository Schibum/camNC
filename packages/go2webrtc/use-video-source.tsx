import { use, useEffect, useMemo } from "react";
import { VideoSource, videoSource } from "./video-source";

const GRACE_PERIOD_MS = 5_000; // 5 seconds, tweak to taste

interface CachedEntry {
  vs: VideoSource;
  refs: number;
  timer?: ReturnType<typeof setTimeout>; // pending dispose timer
}

const cache = new Map<string, CachedEntry>();

export function acquireVideoSource(url: string): VideoSource {
  let entry = cache.get(url);

  if (!entry) {
    entry = { vs: videoSource(url), refs: 0 };
    cache.set(url, entry);
  }

  // If a dispose timer is running, cancel it — we're using the source again
  if (entry.timer) {
    clearTimeout(entry.timer);
    entry.timer = undefined;
  }

  entry.refs += 1;
  return entry.vs;
}

export function releaseVideoSource(url: string): void {
  const entry = cache.get(url);
  if (!entry) return;

  entry.refs -= 1;

  if (entry.refs === 0 && !entry.timer) {
    //  Schedule the real cleanup after the grace period
    entry.timer = setTimeout(async () => {
      // If nobody grabbed it during the wait, dispose it
      const stillEntry = cache.get(url);
      if (stillEntry && stillEntry.refs === 0) {
        await stillEntry.vs.dispose().catch(console.error);
        cache.delete(url);
      }
    }, GRACE_PERIOD_MS);
  }
}

export function useVideoSource(url: string) {
  // Acquire and retain the shared VideoSource for this URL
  const vs = useMemo(() => acquireVideoSource(url), [url]);

  // Release reference when unmounting or URL changes
  useEffect(() => {
    return () => {
      releaseVideoSource(url);
    };
  }, [url]);

  // Suspend React render until connectedPromise resolves or rejects
  const connectedInfo = use(vs.connectedPromise);

  return {
    src: connectedInfo.src,
    maxResolution: connectedInfo.maxResolution,
    source: vs,
  };
}
