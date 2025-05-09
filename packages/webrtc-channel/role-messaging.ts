import mitt, { Emitter } from "mitt";
import { FirebaseSignaller, PeerInfo } from "./firebase-signaller";
import Peer from "./peer";

type Events = {
  message: any;
  ready: void;
};

/**
 * Wait for peers with a given role to join the room and creates p2p2 data connections to all those peers.
 * Allows to send and receive messages to all peers with the given role.
 */
export class RoleMessaging {
  private signaller = new FirebaseSignaller();
  private peers = new Map<string, Peer>();
  private readonly isPolite: boolean;

  public readonly on: Emitter<Events>["on"];
  public readonly off: Emitter<Events>["off"];
  public readonly emit: Emitter<Events>["emit"];

  constructor(
    private readonly roomId: string,
    private readonly selfRole: string,
    private readonly toRole: string
  ) {
    this.isPolite = this.shallBePolite();
    console.log("isPolite", this.isPolite);

    const bus = mitt<Events>();
    this.on = bus.on;
    this.off = bus.off;
    this.emit = bus.emit;
  }

  async disconnect() {
    console.log("disconnecting");
    await this.signaller.disconnect();
    for (const peer of this.peers.values()) {
      peer.peerConnection.close();
    }
  }

  async join() {
    this.signaller.on("peer-joined", (ev) => this.onPeerJoined(ev));
    await this.signaller.join(this.roomId, this.selfRole);
  }

  async sendMessage(message: string) {
    for (const [peerId, peer] of this.peers.entries()) {
      console.log("sending message to", peerId);
      peer.dataChannel.send(message);
    }
  }

  private onPeerJoined(peerInfo: PeerInfo) {
    console.log("onPeerJoined", peerInfo);
    if (peerInfo.role != this.toRole) return;

    let peer = new Peer({ polite: this.isPolite });
    console.log("adding handlers for signalling");
    peer.signalingPort.onmessage = (ev) => {
      console.log(
        "signal out from",
        this.signaller.peerId,
        "to",
        peerInfo.peerId,
        ev.data
      );
      this.signaller.sendMessage(peerInfo.peerId, ev.data);
    };
    this.signaller.on("signal", (ev) => {
      if (ev.from !== peerInfo.peerId) return;
      console.log(
        "signal in from",
        ev.from,
        "to",
        this.signaller.peerId,
        ev.data
      );
      peer.signalingPort.postMessage(ev.data);
    });
    this.peers.set(peerInfo.peerId, peer);
    // test, TODO: refine
    peer.ready.then(() => {
      this.emit("ready");
      console.log("peer ready", peerInfo.peerId);
    });
    peer.dataChannel.addEventListener("close", () => {
      console.log("peer closed", peerInfo.peerId);
      this.peers.delete(peerInfo.peerId);
    });
    peer.dataChannel.addEventListener("message", (ev) => {
      console.log("message from", peerInfo.peerId, ev.data);
      this.emit("message", ev.data);
    });
  }

  private shallBePolite() {
    return this.selfRole.localeCompare(this.toRole) < 0;
  }
}
