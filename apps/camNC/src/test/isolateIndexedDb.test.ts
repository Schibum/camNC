import { expect, it } from 'vitest';

it('gives each test file its own IndexedDB databases', async () => {
  await new Promise((resolve, reject) => {
    const req = indexedDB.open('isolation-check', 1);
    req.onsuccess = () => {
      req.result.close();
      resolve(null);
    };
    req.onerror = () => reject(req.error);
  });
  const names = (await indexedDB.databases()).map(d => d.name ?? '');
  expect(names).not.toContain('isolation-check');
  expect(names.some(n => /^[0-9a-f-]{36}:isolation-check$/.test(n))).toBe(true);
});
