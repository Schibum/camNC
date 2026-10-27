import { describe, expect, it } from 'vitest';
import { chromiumVersion, hostBlockedReason, machineSupport } from './machine-support';

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

describe('hostBlockedReason', () => {
  it('allows private IPs, .local names and localhost on https', () => {
    for (const host of [
      '192.168.178.42',
      '10.0.0.5:8080',
      '172.20.1.1',
      '169.254.3.4',
      '127.0.0.1:8848',
      'fluidnc.local',
      'http://FluidNC.local/',
      'localhost:8848',
      '[fe80::1]',
      '[fd12::3]:81',
    ]) {
      expect(hostBlockedReason(host, 'https:'), host).toBeNull();
    }
  });

  it('blocks names Chrome cannot tell are local, and public IPs', () => {
    for (const host of ['fluidnc', 'fluidnc.fritz.box', 'fluidnc.fritz.box:81', '8.8.8.8', '172.32.0.1', '[2001:db8::1]']) {
      expect(hostBlockedReason(host, 'https:'), host).toContain('IP address');
    }
  });

  it('allows anything from a plain http origin', () => {
    expect(hostBlockedReason('fluidnc.fritz.box', 'http:')).toBeNull();
  });
});
