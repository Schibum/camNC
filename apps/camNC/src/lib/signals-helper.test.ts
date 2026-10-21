import { signal } from '@preact/signals-react';
import { describe, expect, it } from 'vitest';
import { waitForSignal } from './signals-helper';

describe('waitForSignal', () => {
  it('resolves immediately with a non-nullish value', async () => {
    await expect(waitForSignal(() => 42)).resolves.toBe(42);
  });

  it('resolves once the signal becomes non-nullish', async () => {
    const s = signal<number | null>(null);
    const promise = waitForSignal(() => s.value);
    s.value = 0;
    await expect(promise).resolves.toBe(0);
  });

  it('rejects after the timeout', async () => {
    const s = signal<number | null>(null);
    await expect(waitForSignal(() => s.value, 10)).rejects.toThrow(/Timed out/);
  });
});
