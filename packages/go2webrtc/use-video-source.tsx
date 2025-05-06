import { use, useEffect, useMemo } from "react";
import { VideoSource, videoSource } from "./video-source";

const GRACE_PERIOD_MS = 5_000; // 5 seconds, tweak to taste

interface CachedEntry {
  vs: VideoSource;
  refs: number;
  timer?: ReturnType<typeof setTimeout>; // pending dispose timer
}

const cache = new Map<string, CachedEntry>();

// Schedule disposal when entry is idle (refs=0) after the grace period.
function scheduleIdleDispose(url: string, entry: CachedEntry) {
  if (entry.refs === 0 && !entry.timer) {
    entry.timer = setTimeout(async () => {
      const stillEntry = cache.get(url);
      if (stillEntry && stillEntry.refs === 0) {
        await stillEntry.vs.dispose().catch(console.error);
        cache.delete(url);
      }
    }, GRACE_PERIOD_MS);
  }
}

/**
 * Get or create the shared VideoSource for the given URL.
 */
export function getVideoSource(url: string): VideoSource {
  let entry = cache.get(url);
  if (!entry) {
    entry = { vs: videoSource(url), refs: 0 };
    cache.set(url, entry);
  }
  return entry.vs;
}

export function acquireVideoSource(url: string): VideoSource {
  const vs = getVideoSource(url);
  const entry = cache.get(url)!;
  // Cancel pending disposal if any
  if (entry.timer) {
    clearTimeout(entry.timer);
    entry.timer = undefined;
  }
  entry.refs += 1;
  return vs;
}

export function releaseVideoSource(url: string): void {
  const entry = cache.get(url);
  if (!entry) return;
  entry.refs -= 1;
  scheduleIdleDispose(url, entry);
}

export function useVideoSource(url: string) {
  // Create the shared VideoSource (no ref count change yet)
  const vs = useMemo(() => getVideoSource(url), [url]);

  // Actually acquire on mount and release on unmount or URL change
  useEffect(() => {
    acquireVideoSource(url);
    return () => {
      releaseVideoSource(url);
    };
  }, [url]);

  // Suspend render until the source is connected
  const connectedInfo = use(vs.connectedPromise);

  return {
    src: connectedInfo.src,
    // Max resolution of the source. Only defined for WebRTC and Webcam sources ATM.
    maxResolution: connectedInfo.maxResolution,
    source: vs,
  };
}
