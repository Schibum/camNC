import { joinRoom, selfId } from "trystero";
import { getConfig } from "./trystero-server";

export function useTrysteroClient() {
  async function connect(
    options: ClientOptions,
    onStream: (stream: MediaStream) => void
  ) {
    console.log("joining room", options.share);
    console.log("my peer ID is", selfId);
    const room = joinRoom(getConfig(options), options.share);
    room.onPeerJoin((peerId) => {
      console.log("peer joined", peerId);
    });
    room.onPeerLeave((peerId) => {
      console.log("peer left", peerId);
    });
    console.log("room", room);
    room.onPeerStream((stream, peerId) => {
      onStream(stream);
    });
  }

  return { connect };
}

export interface ClientOptions {
  share: string;
  pwd: string;
}
