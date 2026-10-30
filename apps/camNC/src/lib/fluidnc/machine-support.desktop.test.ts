import { describe, expect, it, vi } from 'vitest';
import { hostBlockedReason } from './machine-support';

vi.mock('@/lib/desktop/is-desktop', () => ({ isDesktopApp: () => true }));

describe('hostBlockedReason in the desktop app', () => {
  it('allows private IPv4 addresses and LAN names its HTTP scope covers', () => {
    for (const host of [
      '192.168.178.42',
      '10.0.0.5:8080',
      'localhost:8848',
      'fluidnc.local',
      'fluidnc.fritz.box:81',
      'cnc.lan',
      'cnc.home.arpa',
    ]) {
      expect(hostBlockedReason(host, 'http:'), host).toBeNull();
    }
  });

  it('blocks names and addresses its file uploads could not reach', () => {
    for (const host of ['fluidnc', 'cnc.example.com', '8.8.8.8', '[fd12::3]']) {
      expect(hostBlockedReason(host, 'http:'), host).toContain('local network');
    }
  });
});
