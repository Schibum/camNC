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

/**
 * Creates a stream server that can be shared with clients
 */
export const createServer = (options: ServerOptions) => {
  // Return the API factory
  return {
    connect: () => {
      // Create room and state
      const room = createConnection(options);
      const joinTs = Date.now();

      // Stream management state
      let streamCache: MediaStream | null = null;
      let streamPromise: Promise<MediaStream> | null = null;

      // State management
      const updateState = (newState: ServerState) => {
        options.onStateChange?.(newState);
      };

      // Stream management functions
      const getStream = async (): Promise<MediaStream> => {
        if (streamCache) return streamCache;
        if (streamPromise) return streamPromise;

        streamPromise = (async () => {
          try {
            const stream = await options.streamFactory();
            streamCache = stream;
            return stream;
          } finally {
            streamPromise = null;
          }
        })();

        return streamPromise;
      };

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
      const [sendRole, onRole] = room.makeAction<{ role: string; ts: number }>(
        "role"
      );
      const [_, onGetStream] = room.makeAction<null>("getStream");

      // Handle stream requests
      onGetStream(async (__, peerId) => {
        if (!options.multipleStreams && streamCache) {
          room.removeStream(streamCache);
        }

        const stream = await getStream();
        room.addStream(stream, peerId);
        updateState(ServerState.STREAMING);
      });

      // Handle role announcements
      onRole(({ role, ts }, peerId) => {
        if (role === "server" && ts > joinTs) {
          console.log("There is a newer server, leaving...");
          updateState(ServerState.DISCONNECTED);
          room.leave();
          cleanupStream();
        }
      });

      // Announce server role when peers join
      room.onPeerJoin((peerId) => {
        sendRole({ role: "server", ts: joinTs }, peerId);
      });

      // Clean up when peers leave
      room.onPeerLeave((peerId) => {
        cleanupIfEmpty();
        if (!streamCache) {
          updateState(ServerState.IDLE);
        }
      });

      console.log(`Server started with peer ID ${selfId}`);
      updateState(ServerState.IDLE);

      // Return the disconnect function
      return {
        disconnect: async () => {
          updateState(ServerState.DISCONNECTED);
          await room.leave();
          // Hack: wait for disconnect to complete - above await resolves too early.
          await wait(100);
          cleanupStream();
        },
      };
    },
  };
};

/**
 * Creates a stream client that can receive streams from the server
 */
export const createClient = (
  options: ClientOptions,
  {
    onStream,
    onServerPeerIdChange,
  }: {
    onStream: (stream: MediaStream) => void;
    onServerPeerIdChange?: (peerId: string | null) => void;
  }
) => {
  return {
    connect: () => {
      // Create room
      const room = createConnection(options);
      const joinTs = Date.now();
      let serverPeerId: string | null = null;

      // State management
      const updateState = (newState: ClientState) => {
        options.onStateChange?.(newState);
      };

      // Setup actions
      const [sendRole, onRole] = room.makeAction<{ role: string; ts: number }>(
        "role"
      );
      const [sendGetStream, _] = room.makeAction<null>("getStream");

      // Initial state
      updateState(ClientState.CONNECTING);

      // Handle role announcements
      onRole(({ role }, peerId) => {
        if (role === "server") {
          serverPeerId = peerId;
          onServerPeerIdChange?.(serverPeerId);
          updateState(ClientState.CONNECTED);
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
          onServerPeerIdChange?.(serverPeerId);
          updateState(ClientState.CONNECTING);
        }
      });

      // Handle incoming streams
      room.onPeerStream((stream) => {
        updateState(ClientState.STREAMING);
        onStream(stream);
      });

      console.log(`Client started with peer ID ${selfId}`);

      // Return the API
      return {
        disconnect: async () => {
          updateState(ClientState.DISCONNECTED);
          await room.leave();
          // Hack: wait for disconnect to complete - above await resolves too early.
          await wait(100);
        },
      };
    },
  };
};

// --- React hooks for easy consumption ---

const serverSerializer = createSerializer();
/**
 * React hook to use a WebRTC server that shares streams
 */
export function useTrysteroServer(options: ServerOptions) {
  const serverRef = useRef<ReturnType<
    ReturnType<typeof createServer>["connect"]
  > | null>(null);
  const [serverState, setServerState] = useState<ServerState>(ServerState.IDLE);

  useEffect(() => {
    // Create and connect the server
    serverSerializer(async () => {
      const server = createServer({
        ...options,
        onStateChange: setServerState,
      }).connect();
      serverRef.current = server;
    });

    // Cleanup on unmount
    return () => {
      serverSerializer(async () => {
        await serverRef.current?.disconnect();
        serverRef.current = null;
      });
    };
  }, [options.share]); // Only reconnect if room name changes

  return {
    serverState,
    disconnect: () => serverRef.current?.disconnect(),
  };
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

const clientSerializer = createSerializer();
/**
 * React hook to use a WebRTC client that receives streams
 * Hack: serialize disconnect/connect to prevent race conditions with async disconnect.
 */
export function useTrysteroClient(
  onStream: (stream: MediaStream) => void,
  options: ClientOptions
) {
  const [serverPeerId, setServerPeerId] = useState<string | null>(null);
  const [clientState, setClientState] = useState<ClientState>(
    ClientState.DISCONNECTED
  );
  const clientRef = useRef<ReturnType<
    ReturnType<typeof createClient>["connect"]
  > | null>(null);

  useEffect(() => {
    // Create and connect the client
    clientSerializer(async () => {
      const client = createClient(
        {
          ...options,
          onStateChange: setClientState,
        },
        {
          onStream,
          onServerPeerIdChange: setServerPeerId,
        }
      ).connect();
      clientRef.current = client;
    });

    // Cleanup on unmount
    return () => {
      clientSerializer(async () => {
        if (!clientRef.current) return;
        await clientRef.current.disconnect();
        clientRef.current = null;
      });
    };
  }, [options.share, onStream]); // Reconnect if room name or stream handler changes

  return {
    serverPeerId,
    clientState,
    disconnect: () => clientRef.current?.disconnect(),
  };
}
