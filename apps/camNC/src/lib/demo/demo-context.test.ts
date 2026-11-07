import { describe, expect, it } from 'vitest';
import { detectDemoContext, isDemoChoiceUrl, shouldUseLocalPreviewDemo } from './demo-context';

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
  it('starts a keyless local root in camera-free simulation before any normal settings can hydrate', () => {
    const root = new URL('http://127.0.0.1:5181/'),
      storage = tab();
    const localPreview = shouldUseLocalPreviewDemo(root, { desktop: false, publishableKey: '' });
    expect(localPreview).toBe(true);
    expect(detectDemoContext(root, storage, { localPreview })).toEqual({ demo: true, rehearsalId: null, noCamera: true });
    expect(detectDemoContext(new URL('/cam', root), storage, { localPreview })).toEqual({ demo: true, rehearsalId: null, noCamera: true });
    expect(detectDemoContext(root, null, { localPreview })).toEqual({ demo: true, rehearsalId: null, noCamera: true });
  });
  it('preserves the local demo choice page and explicit camera choices', () => {
    const root = new URL('http://localhost:5181'),
      storage = tab(),
      options = { localPreview: true };
    const choice = new URL('/demo', root);
    expect(isDemoChoiceUrl(choice)).toBe(true);
    expect(detectDemoContext(choice, storage, options)).toEqual({ demo: true, rehearsalId: null, noCamera: true });
    const on = new URL('/demo?machine=1&camera=on', root);
    expect(isDemoChoiceUrl(on)).toBe(false);
    expect(detectDemoContext(on, storage, options).noCamera).toBe(false);
    const off = new URL('/demo?camera=off', root);
    expect(isDemoChoiceUrl(off)).toBe(false);
    expect(detectDemoContext(off, storage, options).noCamera).toBe(true);
  });
  it('never replaces configured web authentication or desktop settings with automatic demo mode', () => {
    for (const host of ['http://localhost:5181', 'http://127.0.0.1:5181', 'http://[::1]:5181']) {
      const root = new URL(host);
      expect(shouldUseLocalPreviewDemo(root, { desktop: false })).toBe(true);
      expect(shouldUseLocalPreviewDemo(root, { desktop: false, publishableKey: 'pk_test_configured' })).toBe(false);
      expect(shouldUseLocalPreviewDemo(root, { desktop: true })).toBe(false);
    }
    for (const host of ['https://camnc.example', 'https://localhost.evil.example', 'https://127.0.0.1.evil.example'])
      expect(shouldUseLocalPreviewDemo(new URL(host), { desktop: false })).toBe(false);
    expect(detectDemoContext(url('/'), tab(), { localPreview: false })).toEqual({ demo: false, rehearsalId: null, noCamera: false });
  });
});
