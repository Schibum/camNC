import mitt from 'mitt';
import { describe, expect, it, vi } from 'vitest';

const signallers: MockSignaller[] = [];

class MockSignaller {
  private bus = mitt<any>();
  on = this.bus.on;
  emit = this.bus.emit;
  join = vi.fn(async () => {});
  disconnect = vi.fn(async () => {});
  sendMessage = vi.fn();
  constructor() {
    signallers.push(this);
  }
}

class MockPeer {
  private bus = mitt<any>();
  on = this.bus.on;
  ready = Promise.resolve();
  signalingPort = { onmessage: null, postMessage: vi.fn() };
  dataChannel = { addEventListener: vi.fn(), send: vi.fn() };
  destroy = vi.fn(() => this.bus.emit('close'));
}

vi.mock('./firebase-signaller', () => ({ FirebaseSignaller: MockSignaller }));
vi.mock('./peer', () => ({ default: MockPeer }));

const { RolePeering } = await import('./role-peering');

describe('RolePeering (unit)', () => {
  it('does not re-join signalling when destroyed after reaching maxPeers', async () => {
    signallers.length = 0;
    const peering = new RolePeering('room', 'client', 'server', { maxPeers: 1 });
    await peering.join();
    expect(signallers).toHaveLength(1);

    signallers[0]!.emit('peer-joined', { peerId: 'p1', role: 'server' });
    // Wait for peer.ready -> signalling is closed as maxPeers is reached.
    await vi.waitFor(() => expect(signallers[0]!.disconnect).toHaveBeenCalled());

    await peering.destroy();
    await new Promise(res => setTimeout(res));
    expect(signallers).toHaveLength(1);
  });
});
