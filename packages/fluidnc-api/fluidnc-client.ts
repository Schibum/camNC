import { signal } from '@preact/signals-react';
import { comlinkMpMiddleware } from '@wbcnc/webrtc-channel/comlink/comlink-mp-middleware';
import createChunkedPort from '@wbcnc/webrtc-channel/data-chunker';
import Peer from '@wbcnc/webrtc-channel/peer';
import { RolePeering } from '@wbcnc/webrtc-channel/role-peering';
import * as Comlink from 'comlink';
import log from 'loglevel';
import type { FluidncApi } from './fluidnc-api';

export class FluidncClient {
  private peering: RolePeering;
  // FluidNC Api or null while disconnected.
  public api: Comlink.Remote<FluidncApi> | null = null;
  public isConnected = signal(false);
  constructor(public accessToken: string) {
    this.peering = new RolePeering(accessToken, 'client', 'server', {
      maxPeers: 10,
    });
    this.peering.on('peerConnected', ({ peerId, peer }) => this.onPeerConnected(peerId, peer));
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
    log.debug('onPeerConnected', peerId, peer);
    peer.on('close', () => this.onPeerDisconnected());

    let port2 = createChunkedPort(peer.dataChannel);
    this.api = Comlink.wrap<FluidncApi>(comlinkMpMiddleware(port2));
    this.isConnected.value = true;
  }
}
