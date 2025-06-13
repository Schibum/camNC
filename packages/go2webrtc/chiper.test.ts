import { describe, expect, it, vi } from 'vitest';
import { cipher } from './cipher';
describe('cipher', () => {
  it('should encrypt and decrypt', async () => {
    const helper = await cipher('test', 'test', 'test-nonce');
    const date = new Date(2000, 1, 1, 19);
    vi.setSystemTime(date);
    const helper2 = await cipher('test', 'test', 'test-nonce');
    const encrypted = await helper.encrypt('test-msg');
    const decrypted = await helper.decrypt(encrypted);
    expect(decrypted).toBe('test-msg');
    expect(await helper2.decrypt(encrypted)).toBe('test-msg');
  });
});
