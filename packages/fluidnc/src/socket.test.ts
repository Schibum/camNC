import { describe, expect, it } from 'vitest';
import { FluidncSocket, normalizeHost, socketUrl } from './socket';

class PendingSocket extends EventTarget {
  readyState = 0;
  binaryType = 'blob';

  close() {
    this.readyState = 3;
  }
}

function pendingConnection() {
  const attempts: PendingSocket[] = [];
  class WebSocketImpl extends PendingSocket {
    constructor(_url: string) {
      super();
      attempts.push(this);
    }
  }
  const socket = new FluidncSocket({ host: 'fluidnc.local', WebSocketImpl: WebSocketImpl as unknown as typeof WebSocket });
  return { socket, attempts };
}

describe('connection cancellation', () => {
  it('ignores a resolved handshake whose continuation belongs to an earlier start', async () => {
    const { socket, attempts } = pendingConnection();
    try {
      socket.start();
      attempts[0]!.readyState = 1;
      attempts[0]!.dispatchEvent(new Event('open'));
      // The handshake resolved, but connectRound has not attached it yet.
      socket.stop();
      socket.start();
      await Promise.resolve();
      expect(attempts[0]!.readyState).toBe(3);
      expect(socket.state).toBe('connecting');
      attempts[1]!.readyState = 1;
      attempts[1]!.dispatchEvent(new Event('open'));
      await Promise.resolve();
      attempts[0]!.dispatchEvent(new Event('close'));
      expect(socket.isOpen()).toBe(true);
    } finally {
      socket.stop();
    }
  });

  it('closes a pending handshake on stop and leaves a restart independent', async () => {
    const { socket, attempts } = pendingConnection();
    try {
      socket.start();
      socket.stop();
      expect(attempts[0]!.readyState).toBe(3);
      socket.start();
      expect(attempts).toHaveLength(2);
      attempts[1]!.readyState = 1;
      attempts[1]!.dispatchEvent(new Event('open'));
      await Promise.resolve();
      expect(socket.isOpen()).toBe(true);
    } finally {
      socket.stop();
    }
  });

  it('does not try another variant after a stopped handshake fails', async () => {
    const { socket, attempts } = pendingConnection();
    try {
      socket.start();
      socket.stop();
      attempts[0]!.dispatchEvent(new Event('error'));
      await Promise.resolve();
      expect(attempts).toHaveLength(1);
      expect(socket.state).toBe('idle');
    } finally {
      socket.stop();
    }
  });
});

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
    expect(normalizeHost('fluidnc.local:8848?x=1')).toBe('fluidnc.local:8848');
  });

  it('stays linear on pathological input', () => {
    const start = performance.now();
    expect(normalizeHost('a' + '#'.repeat(50_000))).toBe('a');
    expect(performance.now() - start).toBeLessThan(100);
  });
});
