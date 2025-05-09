/* rtc.ts ───────────────────────────────────────────────────────────
   Perfect-negotiation implementation • robust against early ICE     */

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
  readonly peerConnection: RTCPeerConnection;
  private readonly internalDataChannel: RTCDataChannel;
  readonly dataChannel: RTCDataChannel;
  readonly signalingPort: MessagePort;
  readonly polite: boolean;
  readonly ready: Promise<void>;
  readonly signal: AbortSignal;

  private makingOffer = false;
  private ignoreOffer = false;
  private isSettingRemoteAnswerPending = false;

  private pendingCandidates: RTCIceCandidateInit[] = [];

  private abortCtrl = new AbortController();
  private send: (env: SignalEnvelope) => void;

  constructor(opts: PeerOptions = {}) {
    this.polite = opts.polite ?? true;
    this.signal = opts.signal ?? this.abortCtrl.signal;

    /* PeerConnection */
    this.peerConnection = new RTCPeerConnection({
      iceServers: opts.iceServers ?? DEFAULT_ICE,
    });

    /* Negotiated symmetric channel */
    this.internalDataChannel = this.peerConnection.createDataChannel("both", {
      negotiated: true,
      id: 0,
    });
    this.dataChannel = this.peerConnection.createDataChannel(
      "user-data-channel",
      {
        negotiated: true,
        id: 1,
      }
    );

    /* Bootstrap signalling via MessageChannel */
    const { port1, port2 } = new MessageChannel();
    this.signalingPort = port1;
    this.send = (env) => port2.postMessage(JSON.stringify(env));
    port2.onmessage = (e) => {
      const env = this.parse(e.data);
      if (env) this.onSignal(env);
    };

    /* Swap to in-band signalling once channel opens */
    let internalDataChannelReady = new Promise<void>((resolve) => {
      this.internalDataChannel.addEventListener(
        "open",
        () => {
          this.send = (env) =>
            this.internalDataChannel.send(JSON.stringify(env));
          this.internalDataChannel.addEventListener("message", (e) => {
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
    let dataChannelReady = new Promise<void>((resolve) => {
      this.dataChannel.addEventListener(
        "open",
        () => {
          resolve();
        },
        { once: true, signal: this.signal }
      );
    });
    this.ready = Promise.all([internalDataChannelReady, dataChannelReady]).then(
      () => {}
    );

    /* Outbound ICE */
    this.peerConnection.addEventListener(
      "icecandidate",
      ({ candidate }) =>
        candidate && this.send({ candidate: candidate.toJSON() }),
      { signal: this.signal }
    );

    /* Abort on ICE failure */
    this.peerConnection.addEventListener(
      "iceconnectionstatechange",
      () => {
        console.log(
          "iceconnectionstatechange",
          this.peerConnection.iceConnectionState
        );
        if (
          ["failed", "disconnected"].includes(
            this.peerConnection.iceConnectionState
          )
        ) {
          this.abortCtrl.abort();
        }
      },
      { signal: this.signal }
    );

    /* negotiationneeded */
    this.peerConnection.addEventListener(
      "negotiationneeded",
      async () => {
        console.log("negotiationneeded");
        try {
          if (this.polite) return;
          this.makingOffer = true;
          await this.peerConnection.setLocalDescription();
          this.send({ description: this.peerConnection.localDescription! });
        } finally {
          this.makingOffer = false;
        }
      },
      { signal: this.signal }
    );
    this.peerConnection.addEventListener("icegatheringstatechange", () => {
      console.log(
        "icegatheringstatechange",
        this.peerConnection.iceGatheringState
      );
    });
    this.peerConnection.addEventListener("connectionstatechange", () => {
      console.log("connectionstatechange", this.peerConnection.connectionState);
      if (this.peerConnection.connectionState === "failed") {
        this.destroy();
      }
    });
    this.dataChannel.addEventListener("close", () => {
      console.log("dataChannel closed");
    });
    this.dataChannel.addEventListener("error", () => {
      console.log("dataChannel error");
    });
  }

  destroy() {
    console.log("destroying peer");
    this.peerConnection.close();
    this.internalDataChannel.close();
    this.dataChannel.close();
    this.signalingPort.close();
  }

  /* ---------------- internal helpers ---------------- */
  private parse(raw: any): SignalEnvelope | null {
    try {
      return typeof raw === "string" ? JSON.parse(raw) : raw;
    } catch {
      return null;
    }
  }

  // We may receive ICE before description out of order via our signalling, so buffer those.
  private async flushPending() {
    console.log("flushing pending candidates");
    for (const cand of this.pendingCandidates.splice(0)) {
      try {
        await this.peerConnection.addIceCandidate(cand);
      } catch (err) {
        console.error("ICE add error (flush)", err);
      }
    }
  }

  private async onSignal(env: SignalEnvelope) {
    console.log("onSignal", this.peerConnection.signalingState);
    if ("description" in env && env.description) {
      const desc = env.description;

      const readyForOffer =
        !this.makingOffer &&
        (this.peerConnection.signalingState === "stable" ||
          this.isSettingRemoteAnswerPending);

      const offerCollision = desc.type === "offer" && !readyForOffer;

      this.ignoreOffer = !this.polite && offerCollision;
      if (this.ignoreOffer) {
        console.log("ignoring offer, clearing pending candidates");
        this.pendingCandidates.length = 0; // discard stale ICE
        return;
      }

      if (
        desc.type === "answer" &&
        this.peerConnection.signalingState !== "have-local-offer" &&
        this.peerConnection.signalingState !== "have-remote-pranswer"
      ) {
        console.warn(
          "Ignoring unexpected answer in signalingState=",
          this.peerConnection.signalingState
        );
        return;
      }

      this.isSettingRemoteAnswerPending = desc.type === "answer";

      try {
        await this.peerConnection.setRemoteDescription(desc); // implicit rollback if needed
        this.isSettingRemoteAnswerPending = false;

        await this.flushPending();

        if (desc.type === "offer") {
          await this.peerConnection.setLocalDescription();

          this.send({ description: this.peerConnection.localDescription! });
        }
      } catch (err) {
        console.error("Negotiation error", err);
      }
    } else if ("candidate" in env && env.candidate) {
      console.log("maybe adding candidate", env.candidate);
      try {
        if (
          this.peerConnection.remoteDescription &&
          this.peerConnection.remoteDescription.type
        ) {
          console.log("actually adding candidate", env.candidate);
          await this.peerConnection.addIceCandidate(env.candidate);
        } else {
          console.log("buffering candidate", env.candidate);
          this.pendingCandidates.push(env.candidate);
        }
      } catch (err) {
        if (!this.ignoreOffer) console.error("ICE add error", err);
      }
    }
  }
}
