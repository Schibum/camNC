import Peer from "../webrtc-channel/peer";

export function createPeerMessageChannel(peer: Peer) {
  const { port1, port2 } = new MessageChannel();
  peer.dataChannel.onmessage = (ev) => {
    port1.postMessage(JSON.parse(ev.data));
  };
  port1.onmessage = (ev) => {
    peer.dataChannel.send(JSON.stringify(ev.data));
  };
  return port2;
}
