import { useEffect } from 'react';

export function useRunInterval(run: (() => Promise<void>) | null, intervalMs: number, firstDelayMs = 5000, enabled = true): void {
  useEffect(() => {
    if (!run || !enabled) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    const tick = async (): Promise<void> => {
      if (cancelled) return;
      if (!document.hidden) {
        await run().catch(err => console.error('run interval failed:', err));
      }
      timer = setTimeout(tick, intervalMs);
    };

    timer = setTimeout(tick, firstDelayMs);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [run, intervalMs, firstDelayMs, enabled]);
}
