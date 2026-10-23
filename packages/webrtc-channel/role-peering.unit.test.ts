import mitt from 'mitt';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocalSignaller, LocalSignalHub } from './test-utils/local-signal-hub';

const peers: MockPeer[] = [];

class MockPeer {
  private bus = mitt<any>();
  on = this.bus.on;
  isInitiator: boolean;
  sid?: string;
  ready: Promise<void>;
  markReady!: () => void;
  signalingPort = { onmessage: null as ((ev: { data: unknown }) => void) | null, postMessage: vi.fn() };
  dataChannel = { addEventListener: vi.fn(), send: vi.fn() };
  destroyed = false;
  destroy = vi.fn(() => {
    if (this.destroyed) return;
    this.destroyed = true;
    this.bus.emit('close');
  });
  constructor(opts: { isInitiator: boolean; sid?: string }) {
    this.isInitiator = opts.isInitiator;
    this.sid = opts.sid;
    this.ready = new Promise(res => (this.markReady = res));
    peers.push(this);
  }
}

vi.mock('./peer', () => ({ default: MockPeer }));

const { RolePeering } = await import('./role-peering');

const offer = (sid?: string) => JSON.stringify({ description: { type: 'offer', sdp: '' }, sid });
const candidate = (sid?: string) => JSON.stringify({ candidate: { candidate: '' }, sid });

describe('RolePeering (unit)', () => {
  let hub: LocalSignalHub;
  let remote: LocalSignaller;
  const roomId = 'room';

  beforeEach(() => {
    peers.length = 0;
    hub = new LocalSignalHub();
    remote = hub.create();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  async function joinAs(selfRole: string, toRole: string, opts = {}) {
    let signaller!: LocalSignaller;
    const peering = new RolePeering(roomId, selfRole, toRole, {
      createSignaller: () => (signaller = hub.create()),
      retryDelayMs: 100,
      connectTimeoutMs: 1000,
      ...opts,
    });
    await peering.join();
    return { peering, signaller: () => signaller };
  }

  it('pairs only with peers of the target role, up to maxPeers', async () => {
    const { peering } = await joinAs('client', 'server', { maxPeers: 1 });
    await hub.create().join(roomId, 'client');
    expect(peers).toHaveLength(0);
    await remote.join(roomId, 'server');
    await hub.create().join(roomId, 'server');
    expect(peers).toHaveLength(1);
    expect(peers[0]!.isInitiator).toBe(false);
    await peering.destroy();
  });

  it('pairs with a waiting peer once a slot frees up', async () => {
    const { peering } = await joinAs('client', 'server', { maxPeers: 1 });
    await remote.join(roomId, 'server');
    const other = hub.create();
    await other.join(roomId, 'server');
    expect(peers).toHaveLength(1);
    await remote.disconnect(); // leave destroys the not-yet-ready peer
    expect(peers[0]!.destroyed).toBe(true);
    expect(peers).toHaveLength(2);
    await peering.destroy();
  });

  it('keeps a connected peer when its signalling leaves', async () => {
    const { peering } = await joinAs('client', 'server');
    await remote.join(roomId, 'server');
    peers[0]!.markReady();
    await vi.waitFor(() => expect(peers[0]!.destroy).not.toHaveBeenCalled());
    await remote.disconnect();
    expect(peers[0]!.destroyed).toBe(false);
    await peering.destroy();
  });

  it('initiator retries with a new sid and backoff while the peer stays', async () => {
    const { peering } = await joinAs('server', 'client');
    await remote.join(roomId, 'client');
    expect(peers).toHaveLength(1);
    const firstSid = peers[0]!.sid;
    expect(firstSid).toBeTruthy();

    peers[0]!.destroy();
    expect(peers).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(100);
    expect(peers).toHaveLength(2);
    expect(peers[1]!.sid).not.toBe(firstSid);

    // Times out without connecting: second retry waits twice as long.
    await vi.advanceTimersByTimeAsync(1000);
    expect(peers[1]!.destroyed).toBe(true);
    await vi.advanceTimersByTimeAsync(150);
    expect(peers).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(100);
    expect(peers).toHaveLength(3);
    await peering.destroy();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(peers).toHaveLength(3);
  });

  it('non-initiator adopts the sid, replaces its peer on a new offer and drops stale signals', async () => {
    const { peering, signaller } = await joinAs('client', 'server');
    await remote.join(roomId, 'server');
    const target = signaller().peerId;

    await remote.sendMessage(target, offer('a'));
    expect(peers).toHaveLength(1);
    expect(peers[0]!.sid).toBe('a');
    expect(peers[0]!.signalingPort.postMessage).toHaveBeenCalledWith(offer('a'));

    await remote.sendMessage(target, offer('b'));
    expect(peers[0]!.destroyed).toBe(true);
    expect(peers).toHaveLength(2);
    expect(peers[1]!.sid).toBe('b');
    expect(peers[1]!.signalingPort.postMessage).toHaveBeenCalledWith(offer('b'));

    await remote.sendMessage(target, candidate('a'));
    expect(peers[1]!.signalingPort.postMessage).toHaveBeenCalledTimes(1);

    // Peers on older builds send no sid.
    await remote.sendMessage(target, candidate());
    expect(peers[1]!.signalingPort.postMessage).toHaveBeenCalledTimes(2);
    await peering.destroy();
  });

  it('forwards outgoing signals to the paired peer', async () => {
    const { peering, signaller } = await joinAs('server', 'client');
    await remote.join(roomId, 'client');
    peers[0]!.signalingPort.onmessage!({ data: 'sdp' });
    expect(signaller().sent).toEqual([{ to: remote.peerId, data: 'sdp' }]);
    await peering.destroy();
  });
});
