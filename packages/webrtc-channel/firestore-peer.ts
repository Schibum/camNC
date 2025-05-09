import { FirestoreSignaller } from "./firestore-signaller";
import Peer from "./peer";

export function wirePeerToFirestore(
  peer: Peer,
  roomId: string
): () => void /* unsubscribe */ {
  const fireSig = new FirestoreSignaller(roomId);

  /* ── outbound  (Peer ➜ Firestore) ─────────────────────────────── */
  const outboundHandler = (ev: MessageEvent<string>) => {
    console.log("outboundHandler", ev.data);
    fireSig.send(JSON.parse(ev.data)); // put into Firestore
  };
  peer.signalingPort.onmessage = outboundHandler;

  /* ── inbound (Firestore ➜ Peer) ───────────────────────────────── */
  const inboundUnsub = fireSig.onSignal((from, env) => {
    console.log("onSignal", from, env);
    peer.signalingPort.postMessage(JSON.stringify(env)); // triggers Peer.onSignal
  });

  /* ── clean-up once the in-band DataChannel opens ──────────────── */
  peer.ready.then(() => {
    console.log("peer ready");
    peer.signalingPort.onmessage = null;
    inboundUnsub(); // stop Firestore listener
    // From now on, signalling flows over peer.dc
  });

  /* allow caller to abort early if needed */
  return () => {
    peer.signalingPort.onmessage = null;
    inboundUnsub();
  };
}
