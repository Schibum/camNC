import { signal } from "@preact/signals-react";
import * as Comlink from "comlink";
import log from "loglevel";
import createChunkedPort from "../webrtc-channel/data-chunker";
import Peer from "../webrtc-channel/peer";
import { RolePeering } from "../webrtc-channel/role-peering";
import type { FluidncApi } from "./fluidnc-api";

export class FluidncClient {
  private peering: RolePeering;
  // FluidNC Api or null while disconnected.
  public api: Comlink.Remote<FluidncApi> | null = null;
  public isConnected = signal(false);
  constructor(public accessToken: string) {
    this.peering = new RolePeering(accessToken, "client", "server", {
      maxPeers: 1,
    });
    this.peering.on("peerConnected", ({ peerId, peer }) =>
      this.onPeerConnected(peerId, peer)
    );
  }

  async start() {
    await this.peering.join();
  }

  async stop() {
    await this.peering.destroy();
  }

  private onPeerDisconnected() {
    this.isConnected.value = false;
    this.api = null;
  }

  private onPeerConnected(peerId: string, peer: Peer) {
    log.debug("onPeerConnected", peerId, peer);
    this.isConnected.value = true;
    peer.on("close", () => this.onPeerDisconnected());

    let port2 = createChunkedPort(peer.dataChannel);
    this.api = Comlink.wrap<FluidncApi>(port2);
  }
}
