/**
 * Resolve when the provided getter returns a non-nullish value.
 * Useful for awaiting the next signal/computed update.
 */
import { effect } from '@preact/signals-react';

export function waitForSignal<T>(getter: () => T | undefined | null, timeoutMs?: number): Promise<T> {
  const current = getter();
  if (current !== undefined && current !== null) {
    return Promise.resolve(current as T);
  }
  return new Promise<T>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const stop = effect(() => {
      const value = getter();
      if (value !== undefined && value !== null) {
        stop();
        clearTimeout(timer);
        resolve(value as T);
      }
    });
    if (timeoutMs !== undefined) {
      timer = setTimeout(() => {
        stop();
        reject(new Error(`Timed out after ${timeoutMs}ms waiting for signal`));
      }, timeoutMs);
    }
  });
}
