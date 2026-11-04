import { describe, expect, it } from 'vitest';
import { detectDemoContext } from './demo-context';

function tab() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
}
const url = (path: string) => new URL(path, 'https://camnc.example');

describe('demo bootstrap context', () => {
  it('opens bare legacy links as a normal-mode choice page and keeps camera-off links working', () => {
    const storage = tab();
    expect(detectDemoContext(url('/demo'), storage).demo).toBe(false);
    expect(detectDemoContext(url('/demo?camera=off'), storage)).toEqual({ demo: true, rehearsalId: null, noCamera: true });
    expect(detectDemoContext(url('/visualize/2DView'), storage).demo).toBe(true);
    expect(detectDemoContext(url('/demo'), storage).demo).toBe(false);
    expect(detectDemoContext(url('/cam'), storage).demo).toBe(false);
  });

  it('retains a tab-local rehearsal across redirects and reloads, and separates tabs', () => {
    const storage = tab();
    const id = crypto.randomUUID();
    expect(detectDemoContext(url(`/demo?rehearsal=${id}`), storage)).toEqual({ demo: true, rehearsalId: id, noCamera: true });
    expect(detectDemoContext(url('/visualize/2DView'), storage).rehearsalId).toBe(id);
    expect(detectDemoContext(url('/cam'), tab()).demo).toBe(false);
    expect(detectDemoContext(url('/demo?machine=1&camera=on'), storage)).toEqual({ demo: true, rehearsalId: null, noCamera: false });
  });

  it('fails closed to simulated hardware for an explicit rehearsal even with blocked tab storage', () => {
    const id = crypto.randomUUID();
    expect(detectDemoContext(url(`/demo?rehearsal=${id}`), null)).toEqual({ demo: true, rehearsalId: id, noCamera: true });
    expect(detectDemoContext(url('/cam'), null).demo).toBe(false);
    expect(detectDemoContext(url('/demo?rehearsal=invalid'), tab()).rehearsalId).toBeNull();
  });
});
