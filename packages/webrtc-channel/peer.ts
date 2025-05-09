/* rtc.ts ───────────────────────────────────────────────────────────
   Perfect-negotiation implementation aligned 1‑to‑1 with the **MDN
   example (2025‑03‑11)** including:
   • `makingOffer`, `ignoreOffer`, **`isSettingRemoteAnswerPending`,
     `readyForOffer`** variables
   • Implicit rollback (no explicit "rollback" sLD)
   • MessageChannel bootstrap ➜ auto‑switch to RTCDataChannel
   • Trickle‑ICE only
*/

export interface PeerOptions {
  polite?: boolean;
  iceServers?: RTCIceServer[];
  signal?: AbortSignal;
}

export type SignalEnvelope =
  | { description: RTCSessionDescriptionInit }
  | { candidate: RTCIceCandidateInit };

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
    this.polite = opts.polite ?? true;
    this.signal = opts.signal ?? this.abortCtrl.signal;

    /* PeerConnection */
    this.pc = new RTCPeerConnection({
      iceServers: opts.iceServers ?? DEFAULT_ICE,
    });

    /* Negotiated symmetric channel */
    this.dc = this.pc.createDataChannel("both", { negotiated: true, id: 0 });

    /* Bootstrap signalling via MessageChannel */
    const { port1, port2 } = new MessageChannel();
    this.signalingPort = port1;
    this.send = (env) => port2.postMessage(JSON.stringify(env));
    port2.onmessage = (e) => {
      const env = this.parse(e.data);
      if (env) this.onSignal(env);
    };

    /* Swap to in‑band signalling once channel opens */
    this.ready = new Promise((resolve) => {
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
          resolve();
        },
        { once: true, signal: this.signal }
      );
    });

    /* Outbound ICE */
    this.pc.addEventListener(
      "icecandidate",
      ({ candidate }) =>
        candidate && this.send({ candidate: candidate.toJSON() }),
      { signal: this.signal }
    );

    /* Abort on ICE failure */
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
          await this.pc.setLocalDescription();
          this.send({ description: this.pc.localDescription! });
        } finally {
          this.makingOffer = false;
        }
      },
      { signal: this.signal }
    );
  }

  /* ---------------- internal helpers ---------------- */
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

      /* ---------- MDN readyForOffer / offerCollision logic ---------- */
      const readyForOffer =
        !this.makingOffer &&
        (this.pc.signalingState === "stable" ||
          this.isSettingRemoteAnswerPending);

      const offerCollision = desc.type === "offer" && !readyForOffer;

      this.ignoreOffer = !this.polite && offerCollision;
      if (this.ignoreOffer) return;

      this.isSettingRemoteAnswerPending = desc.type === "answer";
      try {
        await this.pc.setRemoteDescription(desc); // implicit rollback if needed
        this.isSettingRemoteAnswerPending = false;

        if (desc.type === "offer") {
          await this.pc.setLocalDescription(); // auto‑create answer
          this.send({ description: this.pc.localDescription! });
        }
      } catch (err) {
        console.error("Negotiation error", err);
      }
    } else if ("candidate" in env && env.candidate) {
      try {
        await this.pc.addIceCandidate(env.candidate);
      } catch (err) {
        if (!this.ignoreOffer) console.error("ICE add error", err);
      }
    }
  }
}
