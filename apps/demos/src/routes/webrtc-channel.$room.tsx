import { createFileRoute } from "@tanstack/react-router";
import { Button } from "@wbcnc/ui/components/button";
import { wirePeerToFirestore } from "@wbcnc/webrtc-channel/firestore-peer";
import Peer from "@wbcnc/webrtc-channel/peer";
import { useEffect, useState } from "react";
export const Route = createFileRoute("/webrtc-channel/$room")({
  component: RouteComponent,
});

function useRoom(roomId: string) {
  const [peer] = useState(() => new Peer({ polite: true }));
  useEffect(() => {
    console.log("useRoom", roomId);
    const detach = wirePeerToFirestore(peer, roomId);
    peer.ready.then(() => {
      console.log("peer ready");
    });

    return () => detach();
  }, [peer, roomId]);
  return peer;
}

function RouteComponent() {
  const { room } = Route.useParams();
  const peer = useRoom(room);

  useEffect(() => {
    peer.dc.onmessage = (event) => {
      console.log("message from other peere", event);
    };
  }, [peer]);

  function sendMessage() {
    peer.dc.send("Hello from channel 1");
  }
  return (
    <div>
      <Button onClick={sendMessage}>Send Message</Button>
    </div>
  );
}
