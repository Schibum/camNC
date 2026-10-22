import { describe, expect, it, vi } from 'vitest';
import { createSerializer } from './asyncSerializer';

describe('createSerializer', () => {
  it('runs tasks sequentially', async () => {
    const serialize = createSerializer();
    const events: string[] = [];
    const task = (name: string, ms: number) => async () => {
      events.push(`start ${name}`);
      await new Promise(res => setTimeout(res, ms));
      events.push(`end ${name}`);
      return name;
    };
    const results = await Promise.all([serialize(task('a', 20)), serialize(task('b', 1))]);
    expect(results).toEqual(['a', 'b']);
    expect(events).toEqual(['start a', 'end a', 'start b', 'end b']);
  });

  it('runs a failing task once and continues with the next one', async () => {
    const serialize = createSerializer();
    const failing = vi.fn(async () => {
      throw new Error('boom');
    });
    await expect(serialize(failing)).rejects.toThrow('boom');
    expect(failing).toHaveBeenCalledTimes(1);
    await expect(serialize(async () => 'next')).resolves.toBe('next');
  });
});
