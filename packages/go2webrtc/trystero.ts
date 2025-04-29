import { useEffect, useRef, useState } from "react";
import { joinRoom, Room, selfId } from "trystero/supabase";

const appId = "https://jcjdafitddtarffkicpz.supabase.co";
const supabaseKey =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpjamRhZml0ZGR0YXJmZmtpY3B6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDUyNjEwMzgsImV4cCI6MjA2MDgzNzAzOH0.VnM4OElAvKn4k7EEHxR_LAjXQggMDOffVtGl9YWXUuQ";

// --- Core Types ---
export enum ServerState {
  IDLE = "idle",
  STREAMING = "streaming",
  DISCONNECTED = "disconnected",
}

export enum ClientState {
  CONNECTING = "connecting",
  CONNECTED = "connected",
  STREAMING = "streaming",
  DISCONNECTED = "disconnected",
}

export interface TrysteroOptions {
  share: string;
  pwd: string;
}

export interface ServerOptions extends TrysteroOptions {
  streamFactory: () => Promise<MediaStream>;
  // Whether to disable existing stream when a new peer joins.
  multipleStreams?: boolean;
  onStateChange?: (state: ServerState) => void;
}

export interface ClientOptions extends TrysteroOptions {
  onStateChange?: (state: ClientState) => void;
}

/**
 * Creates a serializer that ensures async operations run sequentially
 * by chaining them one after another.
 */
function createSerializer() {
  let lastPromise: Promise<unknown> = Promise.resolve();

  return async <R>(fn: () => Promise<R>): Promise<R> => {
    // Create a new promise chain that starts after the previous task
    const result = lastPromise.then(() => fn()).catch(() => fn()); // If previous task failed, still run new task

    // Update the lastPromise to this new promise chain
    // This must happen synchronously to prevent race conditions
    lastPromise = result.catch(() => {});

    // Return the result promise so caller gets proper resolve/reject
    return result;
  };
}

// Module-scoped serializers
const clientSerializer = createSerializer();
const serverSerializer = createSerializer();

// --- Pure functions for connection management (non-React) ---

/**
 * Creates a room connection
 */
const createConnection = (options: TrysteroOptions): Room => {
  const config = {
    appId,
    supabaseKey,
    // password: options.pwd (commented out in original)
  };

  return joinRoom(config, options.share);
};

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// --- Stream management functions for createServer
const getStream = async (
  options: ServerOptions,
  streamCache: MediaStream | null,
  streamPromise: Promise<MediaStream> | null
): Promise<{
  stream: MediaStream;
  streamPromise: Promise<MediaStream> | null;
}> => {
  if (streamCache) return { stream: streamCache, streamPromise };
  if (streamPromise) return { stream: await streamPromise, streamPromise };

  const newPromise = (async () => {
    try {
      return await options.streamFactory();
    } catch (error) {
      console.error("Error creating stream:", error);
      throw error;
    }
  })();

  return { stream: await newPromise, streamPromise: null };
};

/**
 * Creates a stream server that can be shared with clients
 */
export const createServer = (options: ServerOptions) => {
  let room: Room | null = null;
  let streamCache: MediaStream | null = null;
  let streamPromise: Promise<MediaStream> | null = null;
  let joinTs: number = 0;

  return {
    connect: async (): Promise<void> => {
      await serverSerializer(async () => {
        joinTs = Date.now();
        room = createConnection(options);
      });
      if (!room) return;
      options.onStateChange?.(ServerState.IDLE);

      const cleanupStream = () => {
        if (streamCache) {
          streamCache.getTracks().forEach((track) => track.stop());
          streamCache = null;
        }
      };

      const cleanupIfEmpty = () => {
        if (room && Object.keys(room.getPeers()).length === 0) {
          console.log("No peers left, cleaning up...");
          cleanupStream();
        }
      };

      // Setup actions
      const [sendRole, onRole] = room.makeAction<{
        role: string;
        ts: number;
      }>("role");
      const [_, onGetStream] = room.makeAction<null>("getStream");

      // Handle stream requests
      onGetStream(async (__, peerId) => {
        if (!room) return;

        if (!options.multipleStreams && streamCache) {
          room.removeStream(streamCache);
        }

        const result = await getStream(options, streamCache, streamPromise);
        streamCache = result.stream;
        streamPromise = result.streamPromise;

        room.addStream(streamCache, peerId);
        options.onStateChange?.(ServerState.STREAMING);
      });

      // Handle role announcements
      onRole(({ role, ts }, peerId) => {
        if (role === "server" && ts > joinTs && room) {
          console.log("There is a newer server, leaving...");
          options.onStateChange?.(ServerState.DISCONNECTED);
          room.leave();
          cleanupStream();
        }
      });

      // Announce server role when peers join
      room.onPeerJoin((peerId) => {
        if (room) {
          sendRole({ role: "server", ts: joinTs }, peerId);
        }
      });

      // Clean up when peers leave
      room.onPeerLeave((peerId) => {
        cleanupIfEmpty();
        if (!streamCache) {
          options.onStateChange?.(ServerState.IDLE);
        }
      });

      console.log(`Server started with peer ID ${selfId}`);
    },

    disconnect: async (): Promise<void> => {
      return serverSerializer(async () => {
        if (!room) return;
        options.onStateChange?.(ServerState.DISCONNECTED);
        await room.leave();
        // Hack: wait for disconnect to complete - above await resolves too early.
        await wait(100);
        if (streamCache) {
          streamCache.getTracks().forEach((track) => track.stop());
          streamCache = null;
        }
        room = null;
      });
    },
  };
};

/**
 * Creates a stream client that can receive streams from the server
 */
export const createClient = (options: ClientOptions) => {
  let room: Room | null = null;

  return {
    connect: async (): Promise<MediaStream> => {
      await clientSerializer(async () => {
        room = createConnection(options);
      });
      const joinTs = Date.now();
      let serverPeerId: string | null = null;
      options.onStateChange?.(ClientState.CONNECTING);

      // Create a single stable stream that will be returned and updated
      const outputStream = new MediaStream();

      return new Promise<MediaStream>((resolve) => {
        let resolved = false;

        if (!room) {
          throw new Error("Room connection failed");
        }

        // Setup actions
        const [sendRole, onRole] = room.makeAction<{
          role: string;
          ts: number;
        }>("role");
        const [sendGetStream, _] = room.makeAction<null>("getStream");

        // Handle role announcements
        onRole(({ role }, peerId) => {
          if (role === "server") {
            console.log("client: got server", peerId);
            serverPeerId = peerId;
            options.onStateChange?.(ClientState.CONNECTED);
            sendGetStream(null, peerId);
          }
        });

        // Announce client role when peers join
        room.onPeerJoin((peerId) => {
          sendRole({ role: "client", ts: joinTs }, peerId);
        });

        // Handle peer leaving
        room.onPeerLeave((peerId) => {
          if (peerId === serverPeerId) {
            serverPeerId = null;
            options.onStateChange?.(ClientState.CONNECTING);
          }
        });

        // Handle incoming streams
        room.onPeerStream((incomingStream) => {
          // Remove existing tracks
          outputStream
            .getTracks()
            .forEach((track) => outputStream.removeTrack(track));

          // Add new tracks from incoming stream
          incomingStream
            .getTracks()
            .forEach((track) => outputStream.addTrack(track));

          options.onStateChange?.(ClientState.STREAMING);

          // Only resolve the first time to return the stable stream
          if (!resolved) {
            resolved = true;
            resolve(outputStream);
          }
        });

        console.log(`Client started with peer ID ${selfId}`);
      });
    },

    disconnect: async (): Promise<void> => {
      return clientSerializer(async () => {
        console.log("disconnecting client");
        if (!room) return;
        options.onStateChange?.(ClientState.DISCONNECTED);
        await room.leave();
        // Hack: wait for disconnect to complete - above await resolves too early.
        await wait(100);
        room = null;
      });
    },
  };
};

// --- React hooks for easy consumption ---

/**
 * React hook to use a WebRTC server that shares streams
 */
export function useTrysteroServer(options: ServerOptions) {
  const [serverState, setServerState] = useState<ServerState>(ServerState.IDLE);
  const serverRef = useRef(
    createServer({
      ...options,
      onStateChange: setServerState,
    })
  );

  useEffect(() => {
    const server = serverRef.current;
    server.connect();

    return () => {
      server.disconnect();
    };
  }, [options.share]); // Only reconnect if room name changes

  return {
    serverState,
    disconnect: () => serverRef.current.disconnect(),
  };
}

/**
 * React hook to use a WebRTC client that receives streams
 */
export function useTrysteroClient(options: ClientOptions) {
  const [clientState, setClientState] = useState<ClientState>(
    ClientState.DISCONNECTED
  );
  const clientRef = useRef(
    createClient({
      ...options,
      onStateChange: setClientState,
    })
  );
  const [stream, setStream] = useState<MediaStream | null>(null);

  useEffect(() => {
    const client = clientRef.current;

    const connectAndGetStream = async () => {
      try {
        const mediaStream = await client.connect();
        setStream(mediaStream);
      } catch (error) {
        console.error("Failed to connect:", error);
      }
    };

    connectAndGetStream();

    return () => {
      client.disconnect();
    };
  }, [options.share]); // Reconnect if room name changes

  return {
    clientState,
    stream,
    disconnect: () => clientRef.current.disconnect(),
  };
}
