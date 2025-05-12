import { signal } from "@preact/signals-react";
import Peer from "@wbcnc/webrtc-channel/peer";
import { RolePeering } from "@wbcnc/webrtc-channel/role-peering";
import { initTestFbApp } from "@wbcnc/webrtc-channel/test-fb-config";
import * as Comlink from "comlink";
import log from "loglevel";
import { FluidncApi } from "./fluidnc-api";
log.setDefaultLevel(log.levels.DEBUG);

initTestFbApp();

export class FluidncServer {
  private peering: RolePeering;
  private fluidApi = new FluidncApi();
  public numConnected = signal(0);
  constructor(roomId: string) {
    this.peering = new RolePeering(roomId, "server", "client");
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

  private onPeerDisconnected(peerId: string) {
    log.debug("onPeerDisconnected", peerId);
    this.numConnected.value--;
  }

  private onPeerConnected(peerId: string, peer: Peer) {
    log.debug("onPeerConnected", peerId, peer);
    this.numConnected.value++;
    peer.on("close", () => this.onPeerDisconnected(peerId));
    // TODO:
    const { port1, port2 } = new MessageChannel();
    peer.dataChannel.onmessage = (ev) => {
      port1.postMessage(ev.data);
    };
    port1.onmessage = (ev) => {
      peer.dataChannel.send(ev.data);
    };
    // Close handling needed?
    // peer.on("close", () => {
    //   port1.close();
    //   port2.close();
    // });
    Comlink.expose(this.fluidApi, port2);
  }
}
