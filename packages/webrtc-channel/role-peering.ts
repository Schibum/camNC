import log from 'loglevel';
import mitt, { Emitter } from 'mitt';
import Peer from './peer';
import type { PeerInfo, Signaller } from './signaller';
import { WsSignaller } from './ws-signaller';

type Events = {
  message: any;
  peerConnected: { peerId: string; peer: Peer };
};

export interface RolePeeringOptions {
  maxPeers?: number;
  /** Defaults to a `WsSignaller` for the signal worker. */
  createSignaller?: () => Signaller | Promise<Signaller>;
  /** A pairing attempt that is not connected after this long is dropped and retried. */
  connectTimeoutMs?: number;
  /** Delay before retrying a failed pairing, doubled per failure up to `maxRetryDelayMs`. */
  retryDelayMs?: number;
  maxRetryDelayMs?: number;
}

interface Slot {
  peer: Peer;
  ready: boolean;
  timeout: ReturnType<typeof setTimeout>;
}

/**
 * Waits for peers with a given role to join the room and creates p2p data
 * connections to them, up to maxPeers. Re-pairs with a peer that is still in
 * the room after its connection failed.
 *
 * The peer whose role sorts higher is the initiator. It tags each attempt with
 * a session id (`sid`) so the other side can tell a new offer from stale
 * messages of a failed attempt.
 */
export class RolePeering {
  private signaller: Signaller | undefined;
  /** Peers of `toRole` currently in the room. */
  private present = new Set<string>();
  private peers = new Map<string, Slot>();
  private failures = new Map<string, number>();
  private retryTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly isInitiator: boolean;
  private readonly opts: Required<Omit<RolePeeringOptions, 'createSignaller'>> & Pick<RolePeeringOptions, 'createSignaller'>;
  private destroyed = false;

  public readonly on: Emitter<Events>['on'];
  public readonly off: Emitter<Events>['off'];
  public readonly emit: Emitter<Events>['emit'];

  constructor(
    private readonly roomId: string,
    private readonly selfRole: string,
    private readonly toRole: string,
    opts: RolePeeringOptions = {}
  ) {
    this.opts = {
      maxPeers: Infinity,
      connectTimeoutMs: 30_000,
      retryDelayMs: 1_000,
      maxRetryDelayMs: 30_000,
      ...opts,
    };
    // in a 'client' 'server' setting, where server streams media to client, server should be initiator.
    this.isInitiator = this.selfRole.localeCompare(this.toRole) > 0;
    log.debug('isInitiator', this.isInitiator);

    const bus = mitt<Events>();
    this.on = bus.on;
    this.off = bus.off;
    this.emit = bus.emit;
  }

  async destroy() {
    log.debug('destroying');
    // Set first: destroying peers emits 'close', which must not schedule retries.
    this.destroyed = true;
    const signaller = this.signaller;
    this.signaller = undefined;
    for (const timer of this.retryTimers.values()) clearTimeout(timer);
    this.retryTimers.clear();
    const slots = Array.from(this.peers.values());
    this.peers.clear();
    this.present.clear();
    for (const slot of slots) slot.peer.destroy();
    await signaller?.disconnect();
  }

  async join() {
    if (this.destroyed) throw new Error('RolePeering was destroyed, create a new instance');
    if (this.signaller) throw new Error('Already joined');
    const signaller = await (this.opts.createSignaller ?? (() => new WsSignaller()))();
    if (this.destroyed) {
      await signaller.disconnect();
      return;
    }
    this.signaller = signaller;
    signaller.on('peer-joined', ev => this.onPeerJoined(ev));
    signaller.on('peer-left', ev => this.onPeerLeft(ev.peerId));
    signaller.on('signal', ev => this.onSignal(ev));
    await signaller.join(this.roomId, this.selfRole);
  }

  async sendMessage(message: string, toPeerId?: string) {
    await Promise.all(
      Array.from(this.peers.entries()).map(async ([peerId, { peer }]) => {
        if (toPeerId && peerId !== toPeerId) return;
        await peer.ready;
        log.debug('sending message to', peerId);
        peer.dataChannel.send(message);
      })
    );
  }

  private onPeerJoined({ peerId, role }: PeerInfo) {
    log.debug('onPeerJoined', peerId, role);
    if (this.destroyed || role !== this.toRole) return;
    this.present.add(peerId);
    this.tryPair(peerId);
  }

  private onPeerLeft(peerId: string) {
    log.debug('onPeerLeft', peerId);
    this.present.delete(peerId);
    this.failures.delete(peerId);
    clearTimeout(this.retryTimers.get(peerId));
    this.retryTimers.delete(peerId);
    // A connected peer doesn't need signalling anymore, leave it to its own ICE state.
    const slot = this.peers.get(peerId);
    if (slot && !slot.ready) slot.peer.destroy();
  }

  private onSignal({ from, data }: { from: string; data: unknown }) {
    if (this.destroyed || !this.present.has(from)) return;
    const { sid, isOffer } = parseEnvelope(data);
    let slot = this.peers.get(from);

    if (sid && slot && slot.peer.sid !== sid) {
      if (this.isInitiator) return; // Stale answer or candidate for an earlier attempt.
      if (slot.peer.sid === undefined) {
        slot.peer.sid = sid;
      } else if (isOffer) {
        log.debug('new offer from', from, 'replacing peer');
        this.dropSlot(from);
        slot = undefined;
      } else {
        return; // Stale candidate.
      }
    }
    if (!slot) {
      // The initiator only answers peers it offered to.
      if (this.isInitiator || this.peers.size >= this.opts.maxPeers) return;
      clearTimeout(this.retryTimers.get(from));
      this.retryTimers.delete(from);
      slot = this.addSlot(from, sid);
    }
    slot.peer.signalingPort.postMessage(data);
  }

  private tryPair(peerId: string) {
    if (this.destroyed || this.peers.has(peerId) || !this.present.has(peerId)) return;
    if (this.retryTimers.has(peerId) || this.peers.size >= this.opts.maxPeers) return;
    this.addSlot(peerId, this.isInitiator ? newSid() : undefined);
  }

  private addSlot(peerId: string, sid: string | undefined): Slot {
    const peer = new Peer({ isInitiator: this.isInitiator, sid });
    peer.signalingPort.onmessage = ev => {
      this.signaller?.sendMessage(peerId, ev.data);
    };
    const slot: Slot = {
      peer,
      ready: false,
      timeout: setTimeout(() => {
        if (!slot.ready) {
          log.debug('pairing timed out', peerId);
          peer.destroy();
        }
      }, this.opts.connectTimeoutMs),
    };
    this.peers.set(peerId, slot);
    peer.ready.then(() => {
      if (this.peers.get(peerId) !== slot) return;
      log.debug('peer ready', peerId);
      slot.ready = true;
      clearTimeout(slot.timeout);
      this.failures.delete(peerId);
      this.emit('peerConnected', { peerId, peer });
    });
    peer.on('close', () => this.onPeerClosed(peerId, slot));
    peer.dataChannel.addEventListener('message', ev => {
      log.debug('message from', peerId, ev.data);
      this.emit('message', ev.data);
    });
    return slot;
  }

  /** Removes a slot without treating it as a failure. */
  private dropSlot(peerId: string) {
    const slot = this.peers.get(peerId);
    if (!slot) return;
    this.peers.delete(peerId);
    clearTimeout(slot.timeout);
    slot.peer.destroy();
  }

  private onPeerClosed(peerId: string, slot: Slot) {
    clearTimeout(slot.timeout);
    if (this.peers.get(peerId) !== slot) return;
    log.debug('peer closed', peerId);
    this.peers.delete(peerId);
    if (this.destroyed) return;
    if (this.present.has(peerId)) this.scheduleRetry(peerId);
    // Capacity freed up: pair with anyone else waiting.
    for (const id of this.present) this.tryPair(id);
  }

  private scheduleRetry(peerId: string) {
    const n = (this.failures.get(peerId) ?? 0) + 1;
    this.failures.set(peerId, n);
    const delay = Math.min(this.opts.retryDelayMs * 2 ** (n - 1), this.opts.maxRetryDelayMs);
    log.debug('retrying', peerId, 'in', delay);
    this.retryTimers.set(
      peerId,
      setTimeout(() => {
        this.retryTimers.delete(peerId);
        this.tryPair(peerId);
      }, delay)
    );
  }
}

function newSid(): string {
  return Math.random().toString(36).slice(2, 10);
}

function parseEnvelope(data: unknown): { sid?: string; isOffer: boolean } {
  try {
    const env = typeof data === 'string' ? JSON.parse(data) : data;
    return {
      sid: typeof env?.sid === 'string' ? env.sid : undefined,
      isOffer: env?.description?.type === 'offer',
    };
  } catch {
    return { isOffer: false };
  }
}
