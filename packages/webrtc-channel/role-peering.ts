import mitt, { Emitter } from "mitt";
import { FirebaseSignaller, PeerInfo } from "./firebase-signaller";
import Peer from "./peer";

import log from "loglevel";

type Events = {
  message: any;
  peerConnected: { peerId: string; peer: Peer };
};

/**
 * Wait for peers with a given role to join the room and creates p2p2 data connections to all those peers.
 * Allows to send and receive messages to all peers with the given role.
 * Closes signalling connection while connected to maxPeers.
 */
export class RolePeering {
  private signaller: FirebaseSignaller | undefined;
  private peers = new Map<string, Peer>();
  private readonly isInitiator: boolean;

  public readonly on: Emitter<Events>["on"];
  public readonly off: Emitter<Events>["off"];
  public readonly emit: Emitter<Events>["emit"];

  constructor(
    private readonly roomId: string,
    private readonly selfRole: string,
    private readonly toRole: string,
    private readonly opts: { maxPeers: number } = { maxPeers: Infinity },
  ) {
    this.isInitiator = this.shallBeInitiator();
    log.debug("isInitiator", this.isInitiator);

    const bus = mitt<Events>();
    this.on = bus.on;
    this.off = bus.off;
    this.emit = bus.emit;
  }

  async destroy() {
    log.debug("destroying");
    await this.signaller?.disconnect();
    for (const peer of this.peers.values()) {
      peer.destroy();
    }
  }

  async join() {
    if (this.signaller) throw new Error("Already joined");
    this.signaller = new FirebaseSignaller();
    this.signaller.on("peer-joined", (ev) => this.onPeerJoined(ev));
    await this.signaller.join(this.roomId, this.selfRole);
  }

  async sendMessage(message: string, toPeerId?: string) {
    await Promise.all(
      Array.from(this.peers.entries()).map(async ([peerId, peer]) => {
        if (toPeerId && peerId !== toPeerId) return;
        await peer.ready;
        log.debug("sending message to", peerId);
        peer.dataChannel.send(message);
      }),
    );
  }

  private onPeerJoined(peerInfo: PeerInfo) {
    log.debug("onPeerJoined", peerInfo);
    if (peerInfo.role != this.toRole) return;
    if (this.peers.size >= this.opts.maxPeers) return;
    if (!this.signaller) {
      log.warn("peer joined, but no signaller, skipping");
      return;
    }
    let peer = new Peer({ isInitiator: this.isInitiator });
    log.debug("adding handlers for signalling");
    peer.signalingPort.onmessage = (ev) => {
      this.signaller?.sendMessage(peerInfo.peerId, ev.data);
    };
    this.signaller.on("signal", (ev) => {
      if (ev.from !== peerInfo.peerId) return;
      peer.signalingPort.postMessage(ev.data);
    });
    this.peers.set(peerInfo.peerId, peer);
    peer.ready.then(() => this.onPeerReady(peerInfo.peerId));
    peer.on("close", () => this.onPeerClosed(peerInfo.peerId));
    peer.dataChannel.addEventListener("message", (ev) => {
      log.debug("message from", peerInfo.peerId, ev.data);
      this.emit("message", ev.data);
    });
  }

  private onPeerClosed(peerId: string) {
    log.debug("peer closed", peerId);
    this.peers.delete(peerId);
    this.autoOpenCloseSignalling();
  }

  private onPeerReady(peerId: string) {
    let peer = this.peers.get(peerId);
    if (!peer) throw new Error("peer not found once ready");
    log.debug("peer ready", peerId);
    this.autoOpenCloseSignalling();
    this.emit("peerConnected", { peerId, peer });
  }

  private async autoOpenCloseSignalling() {
    if (this.peers.size >= this.opts.maxPeers) {
      log.debug("autoOpenCloseSignalling: closing signalling");
      if (this.signaller) {
        this.signaller.disconnect();
        this.signaller = undefined;
      }
    } else if (!this.signaller) {
      log.debug("autoOpenCloseSignalling: opening signalling");
      this.signaller = new FirebaseSignaller();
      this.signaller.on("peer-joined", (ev) => this.onPeerJoined(ev));
      await this.signaller.join(this.roomId, this.selfRole);
    }
  }

  private shallBeInitiator() {
    return this.selfRole.localeCompare(this.toRole) < 0;
  }
}
