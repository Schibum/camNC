import { describe, expect, it } from 'vitest';
import { chromiumVersion, machineSupport } from './machine-support';

const nav = (userAgent: string, brands?: { brand: string; version: string }[]) =>
  ({ userAgent, userAgentData: brands ? { brands } : undefined }) as unknown as Navigator;

describe('machineSupport', () => {
  it('reads the version from client hints or the user agent', () => {
    expect(chromiumVersion(nav('', [{ brand: 'Google Chrome', version: '148' }]))).toBe(148);
    expect(chromiumVersion(nav('Mozilla/5.0 Chrome/147.0.0.0 Safari/537.36'))).toBe(147);
    expect(chromiumVersion(nav('Mozilla/5.0 Firefox/140.0'))).toBeNull();
  });

  it('requires Chrome/Edge 147+ on https', () => {
    expect(machineSupport(nav('', [{ brand: 'Google Chrome', version: '147' }]), 'https:').supported).toBe(true);
    expect(machineSupport(nav('', [{ brand: 'Google Chrome', version: '146' }]), 'https:').reason).toContain('146');
    expect(machineSupport(nav('Version/18 Safari/605'), 'https:').supported).toBe(false);
  });

  it('allows any browser from a plain http origin', () => {
    expect(machineSupport(nav('Version/18 Safari/605'), 'http:').supported).toBe(true);
  });
});
