/**
 * Resolve when the provided getter returns a non-nullish value.
 * Useful for awaiting the next signal/computed update.
 */
import { effect } from '@preact/signals-react';

export function waitForSignal<T>(getter: () => T | undefined | null): Promise<T> {
  const current = getter();
  if (current !== undefined && current !== null) {
    return Promise.resolve(current as T);
  }
  return new Promise<T>(resolve => {
    const stop = effect(() => {
      const value = getter();
      if (value !== undefined && value !== null) {
        stop();
        resolve(value as T);
      }
    });
  });
}
