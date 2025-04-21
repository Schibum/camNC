import { useEffect, useRef } from "react";
import { joinRoom, Room, selfId } from "trystero";

const appId = "wbcnc-trystero";

export function useRoom(options: TrysteroOptions) {
  const roomRef = useRef<Room>(joinRoom(getConfig(options), options.share));
  const lastRoomIdRef = useRef<string>(options.share);

  useEffect(() => {
    if (options.share !== lastRoomIdRef.current) {
      roomRef.current.leave();
      roomRef.current = joinRoom(getConfig(options), options.share);
      lastRoomIdRef.current = options.share;
    }

    return () => {
      console.log("leaving room", roomRef.current);
      roomRef.current.leave();
    };
  }, [options, options.share]);

  return roomRef.current;
}

export function useTrysteroServer(options: ServerOptions) {
  // const room = useRoom(options);
  const room = joinRoom(getConfig(options), options.share);
  const streamRef = useRef<MediaStream>(null);

  async function getStream() {
    if (!streamRef.current) {
      streamRef.current = await options.streamFactory();
    }
    return streamRef.current;
  }

  function cleanupStream() {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => {
        track.stop();
      });
      streamRef.current = null;
    }
  }

  function cleanupIfEmpty() {
    if (Object.keys(room.getPeers()).length === 0) {
      console.log("no peers left, cleaning up...");
      cleanupStream();
    }
  }

  async function init() {
    console.log(`my peer ID is ${selfId}`);

    console.log("room peers", room.getPeers());
    if (Object.keys(room.getPeers()).length) {
      console.log("adding stream");
      room.addStream(await getStream());
    }
    room.onPeerJoin(async (peerId) => {
      console.log("peers", room.getPeers());
      room.ping(peerId).then((latency) => {
        console.log("latency to", peerId, latency);
      });
      console.log("peer joined", peerId);
      room.addStream(await getStream(), peerId);
    });
    room.onPeerLeave((peerId) => {
      console.log("peer left", peerId);
      cleanupIfEmpty();
    });
  }

  useEffect(() => {
    init();
  }, [room]);

  return room;
}

export interface TrysteroOptions {
  share: string;
  pwd: string;
}

export interface ServerOptions extends TrysteroOptions {
  streamFactory: () => Promise<MediaStream>;
}

export function getConfig(options: TrysteroOptions) {
  return {
    appId,
    // password: options.pwd,
  };
}
