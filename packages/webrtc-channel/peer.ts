/* rtc.ts ───────────────────────────────────────────────────────────
   Perfect‑negotiation (MDN style, **implicit rollback**) — TypeScript

   Differences from the previous revision
   ──────────────────────────────────────
   • The polite peer NO LONGER calls `setLocalDescription({type: 'rollback'})`.
     The WebRTC spec rolls back implicitly when `setRemoteDescription()` is
     executed while an offer is pending. This matches the MDN example.
   • The rest of the flow (makingOffer, ignoreOffer, trickle ICE, switch to
     in‑band signalling once the data‑channel opens) is unchanged.

   Public surface
   --------------
     new Peer({ polite?, iceServers?, signal? })
       .pc, .dc, .signalingPort, .ready, .signal, .polite
*/

export interface PeerOptions {
  polite?: boolean;
  iceServers?: RTCIceServer[];
  signal?: AbortSignal;
}

interface DescriptionMsg {
  description: RTCSessionDescriptionInit;
}
interface CandidateMsg {
  candidate: RTCIceCandidateInit;
}
export type SignalEnvelope = DescriptionMsg | CandidateMsg;

const DEFAULT_ICE: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:global.stun.twilio.com:3478" },
];

export default class Peer {
  readonly pc: RTCPeerConnection;
  readonly dc: RTCDataChannel;
  readonly signalingPort: MessagePort;
  readonly polite: boolean;
  readonly ready: Promise<void>;
  readonly signal: AbortSignal;

  private makingOffer = false;
  private ignoreOffer = false;
  private isSettingRemoteAnswerPending = false;
  private abortCtrl = new AbortController();
  private send: (env: SignalEnvelope) => void;

  constructor(opts: PeerOptions = {}) {
    /* options */
    this.polite = opts.polite ?? true;
    this.signal = opts.signal ?? this.abortCtrl.signal;

    /* connection */
    this.pc = new RTCPeerConnection({
      iceServers: opts.iceServers ?? DEFAULT_ICE,
    });

    /* negotiated symmetric data‑channel */
    this.dc = this.pc.createDataChannel("both", { negotiated: true, id: 0 });

    /* bootstrap signalling */
    const { port1, port2 } = new MessageChannel();
    this.signalingPort = port1;
    this.send = (env) => port2.postMessage(JSON.stringify(env));
    port2.onmessage = (e) => {
      const env = this.parse(e.data);
      if (env) this.onSignal(env);
    };

    /* switch to in‑band signalling once dc opens */
    this.ready = new Promise((res) => {
      this.dc.addEventListener(
        "open",
        () => {
          this.send = (env) => this.dc.send(JSON.stringify(env));
          this.dc.addEventListener("message", (e) => {
            const env = this.parse(e.data);
            if (env) this.onSignal(env);
          });
          port1.close();
          port2.close();
          res();
        },
        { once: true, signal: this.signal }
      );
    });

    /* ICE candidate outbound */
    this.pc.addEventListener(
      "icecandidate",
      ({ candidate }) =>
        candidate && this.send({ candidate: candidate.toJSON() }),
      { signal: this.signal }
    );

    /* abort on ICE failure */
    this.pc.addEventListener(
      "iceconnectionstatechange",
      () => {
        if (["failed", "disconnected"].includes(this.pc.iceConnectionState)) {
          this.abortCtrl.abort();
        }
      },
      { signal: this.signal }
    );

    /* negotiationneeded */
    this.pc.addEventListener(
      "negotiationneeded",
      async () => {
        try {
          this.makingOffer = true;
          await this.pc.setLocalDescription(); // create + set offer
          this.send({ description: this.pc.localDescription! });
        } finally {
          this.makingOffer = false;
        }
      },
      { signal: this.signal }
    );
  }

  /* helpers */
  private parse(raw: any): SignalEnvelope | null {
    try {
      return typeof raw === "string" ? JSON.parse(raw) : raw;
    } catch {
      return null;
    }
  }

  private async onSignal(env: SignalEnvelope) {
    if ("description" in env && env.description) {
      const desc = env.description;

      const readyForOffer =
        !this.makingOffer &&
        (this.pc.signalingState === "stable" ||
          this.isSettingRemoteAnswerPending);
      const offerCollision = desc.type === "offer" && !readyForOffer;

      this.ignoreOffer = !this.polite && offerCollision;
      if (this.ignoreOffer) return;

      this.isSettingRemoteAnswerPending = desc.type == "answer";
      await this.pc.setRemoteDescription(desc);
      this.isSettingRemoteAnswerPending = false;
      if (desc.type === "offer") {
        await this.pc.setLocalDescription(await this.pc.createAnswer());
        this.send({ description: this.pc.localDescription! });
      }
    } else if ("candidate" in env && env.candidate) {
      try {
        await this.pc.addIceCandidate(env.candidate);
      } catch (err) {
        if (!this.ignoreOffer) throw err;
      }
    }
  }
}
