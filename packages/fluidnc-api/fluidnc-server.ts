import { signal } from '@preact/signals-react';
import { comlinkMpMiddleware } from '@wbcnc/webrtc-channel/comlink/comlink-mp-middleware';
import createChunkedPort from '@wbcnc/webrtc-channel/data-chunker';
import Peer from '@wbcnc/webrtc-channel/peer';
import { RolePeering } from '@wbcnc/webrtc-channel/role-peering';
import * as Comlink from 'comlink';
import log from 'loglevel';
import { FluidncApi } from './fluidnc-api';
// log.setDefaultLevel(log.levels.DEBUG);

export class FluidncServer {
  private peering: RolePeering;
  private fluidApi = new FluidncApi();
  public numConnected = signal(0);
  constructor(public readonly accessToken: string) {
    this.peering = new RolePeering(accessToken, 'server', 'client');
    this.peering.on('peerConnected', ({ peerId, peer }) => this.onPeerConnected(peerId, peer));
  }

  async start() {
    await this.peering.join();
  }

  async stop() {
    await this.peering.destroy();
  }

  private onPeerDisconnected(peerId: string) {
    log.debug('onPeerDisconnected', peerId);
    this.numConnected.value--;
  }

  private onPeerConnected(peerId: string, peer: Peer) {
    log.debug('onPeerConnected', peerId, peer);
    this.numConnected.value++;
    peer.on('close', () => this.onPeerDisconnected(peerId));
    let port2 = createChunkedPort(peer.dataChannel);
    Comlink.expose(this.fluidApi, comlinkMpMiddleware(port2));
  }
}
