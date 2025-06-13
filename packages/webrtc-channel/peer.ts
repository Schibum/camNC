import log from 'loglevel';
import mitt, { Emitter } from 'mitt';

export interface PeerOptions {
  isInitiator?: boolean;
  iceServers?: RTCIceServer[];
  signal?: AbortSignal;
}

export type SignalEnvelope = { description: RTCSessionDescriptionInit } | { candidate: RTCIceCandidateInit };

const DEFAULT_ICE: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:global.stun.twilio.com:3478' }];

type Events = {
  close: void;
};

export default class Peer {
  readonly pc: RTCPeerConnection;
  private readonly internalDataChannel: RTCDataChannel;
  readonly dataChannel: RTCDataChannel;
  readonly signalingPort: MessagePort;
  readonly isInitiator: boolean;
  readonly ready: Promise<void>;
  readonly signal: AbortSignal;

  private makingOffer = false;
  private ignoreOffer = false;
  private isSettingRemoteAnswerPending = false;
  private destroyed = false;

  private pendingCandidates: RTCIceCandidateInit[] = [];

  private abortCtrl = new AbortController();
  private send: (env: SignalEnvelope) => void;

  public readonly on: Emitter<Events>['on'];
  public readonly off: Emitter<Events>['off'];
  public readonly emit: Emitter<Events>['emit'];

  constructor(opts: PeerOptions = {}) {
    this.isInitiator = opts.isInitiator ?? true;
    this.signal = opts.signal ?? this.abortCtrl.signal;

    const bus = mitt<Events>();
    this.on = bus.on;
    this.off = bus.off;
    this.emit = bus.emit;

    /* PeerConnection */
    this.pc = new RTCPeerConnection({
      iceServers: opts.iceServers ?? DEFAULT_ICE,
    });

    /* Negotiated symmetric channel */
    this.internalDataChannel = this.pc.createDataChannel('both', {
      negotiated: true,
      id: 0,
    });
    this.dataChannel = this.pc.createDataChannel('user-data-channel', {
      negotiated: true,
      id: 1,
    });

    /* Bootstrap signalling via MessageChannel */
    const { port1, port2 } = new MessageChannel();
    this.signalingPort = port1;
    this.send = env => port2.postMessage(JSON.stringify(env));
    port2.onmessage = e => {
      const env = this.parse(e.data);
      if (env) this.onSignal(env);
    };

    /* Swap to in-band signalling once channel opens */
    let internalDataChannelReady = new Promise<void>(resolve => {
      this.internalDataChannel.addEventListener(
        'open',
        () => {
          this.send = env => this.internalDataChannel.send(JSON.stringify(env));
          this.internalDataChannel.addEventListener('message', e => {
            const env = this.parse(e.data);
            if (env) this.onSignal(env);
          });
          port1.close();
          port2.close();
          resolve();
        },
        { once: true, signal: this.signal }
      );
    });
    let dataChannelReady = new Promise<void>(resolve => {
      this.dataChannel.addEventListener(
        'open',
        () => {
          resolve();
        },
        { once: true, signal: this.signal }
      );
    });
    this.ready = Promise.all([internalDataChannelReady, dataChannelReady]).then(() => {});

    /* Outbound ICE */
    this.pc.addEventListener('icecandidate', ({ candidate }) => candidate && this.send({ candidate: candidate.toJSON() }), {
      signal: this.signal,
    });

    /* Abort on ICE failure */
    this.pc.addEventListener(
      'iceconnectionstatechange',
      () => {
        log.debug('iceconnectionstatechange', this.pc.iceConnectionState);
        if (['failed', 'disconnected'].includes(this.pc.iceConnectionState)) {
          this.abortCtrl.abort();
        }
      },
      { signal: this.signal }
    );

    /* negotiationneeded */
    this.pc.addEventListener(
      'negotiationneeded',
      async () => {
        log.debug('negotiationneeded');
        try {
          if (!this.isInitiator) return;
          this.makingOffer = true;
          await this.pc.setLocalDescription();
          this.send({ description: this.pc.localDescription! });
        } finally {
          this.makingOffer = false;
        }
      },
      { signal: this.signal }
    );
    this.pc.addEventListener('connectionstatechange', () => {
      log.debug('connectionstatechange', this.pc.connectionState);
      if (['failed', 'disconnected'].includes(this.pc.connectionState)) {
        this.destroy();
      }
    });
    this.dataChannel.addEventListener('close', () => {
      log.debug('dataChannel closed');
      this.destroy();
    });
    this.dataChannel.addEventListener('error', () => {
      log.debug('dataChannel error');
      this.destroy();
    });
  }

  destroy() {
    if (this.destroyed) return;
    this.emit('close');
    this.destroyed = true;
    log.debug('destroying peer');
    this.pc.close();
    this.internalDataChannel.close();
    this.dataChannel.close();
    this.signalingPort.close();
  }

  private parse(raw: any): SignalEnvelope | null {
    try {
      return typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch {
      return null;
    }
  }

  // We may receive ICE before description out of order via our signalling, so buffer those.
  private async flushPending() {
    log.debug('flushing pending candidates');
    for (const cand of this.pendingCandidates.splice(0)) {
      try {
        await this.pc.addIceCandidate(cand);
      } catch (err) {
        log.error('ICE add error (flush)', err);
      }
    }
  }

  private async onSignal(env: SignalEnvelope) {
    log.debug('onSignal pc.state=%s env=%o', this.pc.signalingState, env);
    if ('description' in env && env.description) {
      const desc = env.description;

      const readyForOffer = !this.makingOffer && (this.pc.signalingState === 'stable' || this.isSettingRemoteAnswerPending);

      const offerCollision = desc.type === 'offer' && !readyForOffer;

      this.ignoreOffer = !this.isInitiator && offerCollision;
      if (this.ignoreOffer) {
        log.debug('ignoring offer, clearing pending candidates');
        this.pendingCandidates.length = 0; // discard stale ICE
        return;
      }

      if (desc.type === 'answer' && this.pc.signalingState !== 'have-local-offer' && this.pc.signalingState !== 'have-remote-pranswer') {
        log.warn('Ignoring unexpected answer in signalingState=', this.pc.signalingState);
        return;
      }

      this.isSettingRemoteAnswerPending = desc.type === 'answer';

      try {
        await this.pc.setRemoteDescription(desc); // implicit rollback if needed
        this.isSettingRemoteAnswerPending = false;

        await this.flushPending();

        if (desc.type === 'offer') {
          await this.pc.setLocalDescription();

          this.send({ description: this.pc.localDescription! });
        }
      } catch (err) {
        log.error('Negotiation error', err);
      }
    } else if ('candidate' in env && env.candidate) {
      try {
        if (this.pc.remoteDescription && this.pc.remoteDescription.type) {
          await this.pc.addIceCandidate(env.candidate);
        } else {
          this.pendingCandidates.push(env.candidate);
        }
      } catch (err) {
        if (!this.ignoreOffer) log.error('ICE add error', err);
      }
    }
  }
}
