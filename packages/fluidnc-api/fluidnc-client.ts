import { signal } from "@preact/signals-react";
import * as Comlink from "comlink";
import log from "loglevel";
import Peer from "../webrtc-channel/peer";
import { RolePeering } from "../webrtc-channel/role-peering";
import type { FluidncApi } from "./fluidnc-api";
import { createPeerMessageChannel } from "./peer-message-channel";

export class FluidncClient {
  private peering: RolePeering;
  public api: Comlink.Remote<FluidncApi> | null = null;
  public isConnected = signal(false);
  constructor(roomId: string) {
    this.peering = new RolePeering(roomId, "client", "server", { maxPeers: 1 });
    this.peering.on("peerConnected", ({ peerId, peer }) =>
      this.onPeerConnected(peerId, peer)
    );
  }

  async start() {
    await this.peering.join();
  }

  private onPeerDisconnected() {
    this.isConnected.value = false;
    this.api = null;
  }

  private onPeerConnected(peerId: string, peer: Peer) {
    log.debug("onPeerConnected", peerId, peer);
    this.isConnected.value = true;
    peer.on("close", () => this.onPeerDisconnected());

    let port2 = createPeerMessageChannel(peer);
    this.api = Comlink.wrap<FluidncApi>(port2);
  }
}
