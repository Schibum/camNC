import { describe, expect, it } from 'vitest';
import { normalizeHost, socketUrl } from './socket';

describe('socketUrl', () => {
  it('maps 4.x to the HTTP port with an independent session', () => {
    expect(socketUrl('192.168.1.20', 'v4')).toBe('ws://192.168.1.20/?independent_session');
    expect(socketUrl('127.0.0.1:8848', 'v4')).toBe('ws://127.0.0.1:8848/?independent_session');
  });

  it('maps 3.9.9 to HTTP port + 1, never + 2', () => {
    expect(socketUrl('192.168.1.20', 'v3-81')).toBe('ws://192.168.1.20:81/');
    expect(socketUrl('fluidnc.local:8850', 'v3-81')).toBe('ws://fluidnc.local:8851/');
  });

  it('normalizes what users paste', () => {
    expect(normalizeHost(' http://192.168.1.20/#/ ')).toBe('192.168.1.20');
  });
});
