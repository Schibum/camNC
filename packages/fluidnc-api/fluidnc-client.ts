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
  // Apis of all connected server peers (e.g. multiple WebUI tabs), in connection order.
  private apis = new Map<string, Comlink.Remote<FluidncApi>>();
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

  private onPeerDisconnected(peerId: string) {
    this.apis.delete(peerId);
    // Fall back to the most recently connected peer that is still alive, if any.
    const remaining = Array.from(this.apis.values());
    this.api = remaining[remaining.length - 1] ?? null;
    this.isConnected.value = this.api !== null;
  }

  private onPeerConnected(peerId: string, peer: Peer) {
    log.debug('onPeerConnected', peerId, peer);
    peer.on('close', () => this.onPeerDisconnected(peerId));

    let port2 = createChunkedPort(peer.dataChannel);
    const api = Comlink.wrap<FluidncApi>(comlinkMpMiddleware(port2));
    this.apis.set(peerId, api);
    this.api = api;
    this.isConnected.value = true;
  }
}
