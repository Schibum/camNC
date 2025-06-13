import { useEffect, useRef, useState } from 'react';
import { joinRoom, Room, selfId, updateSelfId } from 'trystero/supabase';

const appId = 'https://jcjdafitddtarffkicpz.supabase.co';
const supabaseKey =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpjamRhZml0ZGR0YXJmZmtpY3B6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDUyNjEwMzgsImV4cCI6MjA2MDgzNzAzOH0.VnM4OElAvKn4k7EEHxR_LAjXQggMDOffVtGl9YWXUuQ';

// --- Core Types ---
export enum ServerState {
  IDLE = 'idle',
  STREAMING = 'streaming',
  DISCONNECTED = 'disconnected',
}

export enum ClientState {
  CONNECTING = 'connecting',
  CONNECTED = 'connected',
  STREAMING = 'streaming',
  DISCONNECTED = 'disconnected',
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

export interface IResolution {
  width: number;
  height: number;
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

const serializer = createSerializer();

/**
 * Creates a room connection
 */
const createConnection = (options: TrysteroOptions) => {
  const config = {
    appId,
    supabaseKey,
    password: options.pwd,
  };

  console.log('joining room ' + options.share);
  updateSelfId();
  const room = joinRoom(config, options.share);

  const [sendRole, onRole] = room.makeAction<{
    role: string;
    ts: number;
  }>('role');
  const [sendGetStream, onGetStream] = room.makeAction<null>('getStream');
  const [sendMaxResolution, onMaxResolution] = room.makeAction<{
    width: number;
    height: number;
  }>('maxRes');

  return {
    room,
    sendRole,
    onRole,
    sendGetStream,
    onGetStream,
    sendMaxResolution,
    onMaxResolution,
  };
};

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

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
      console.error('Error creating stream:', error);
      throw error;
    }
  })();

  return { stream: await newPromise, streamPromise: null };
};

async function getMaxResolution(stream: MediaStream) {
  const track = stream.getVideoTracks()[0];
  if (!track) throw new Error('No video track found');
  let width = track.getSettings().width;
  let height = track.getSettings().height;
  if (!width || !height) throw new Error('No width or height found');
  // HACK, seems like mobile browsers may flip width/height depending on orientation.
  // Assume portrait mode with height > width.
  if (width > height) {
    [width, height] = [height, width];
  }
  // const video = document.createElement("video");
  // video.srcObject = stream;
  // await new Promise<void>((resolve) => {
  //   video.onloadedmetadata = () => {
  //     width = video.videoWidth;
  //     height = video.videoHeight;
  //     resolve();
  //   };
  // });
  return { width, height };
}

/**
 * Creates a stream server that can be shared with clients
 */
export const createServer = (options: ServerOptions) => {
  let _room: Room | null = null;
  let streamCache: MediaStream | null = null;
  let streamPromise: Promise<MediaStream> | null = null;
  let joinTs: number = 0;

  return {
    connect: async (): Promise<void> => {
      joinTs = Date.now();
      let { room, sendRole, onRole, onGetStream, sendMaxResolution } = await serializer(async () => {
        const con = createConnection(options);
        _room = con.room;
        return con;
      });
      if (!room) return;
      options.onStateChange?.(ServerState.IDLE);

      const cleanupStream = () => {
        if (streamCache) {
          streamCache.getTracks().forEach(track => track.stop());
          streamCache = null;
        }
      };

      const cleanupIfEmpty = () => {
        if (room && Object.keys(room.getPeers()).length === 0) {
          console.log('No peers left, cleaning up...');
          cleanupStream();
        }
      };

      // Handle stream requests
      onGetStream(async (__: unknown, peerId: string) => {
        if (!room) return;

        if (!options.multipleStreams && streamCache) {
          room.removeStream(streamCache);
        }

        const result = await getStream(options, streamCache, streamPromise);
        streamCache = result.stream;
        streamPromise = result.streamPromise;

        room.addStream(streamCache, peerId);
        sendMaxResolution(await getMaxResolution(streamCache), peerId);
        options.onStateChange?.(ServerState.STREAMING);
      });

      // Handle role announcements
      onRole(({ role, ts }: { role: string; ts: number }, peerId: string) => {
        if (role === 'server' && ts > joinTs && room) {
          console.log('There is a newer server, leaving...');
          options.onStateChange?.(ServerState.DISCONNECTED);
          room.leave();
          cleanupStream();
        }
      });

      // Announce server role when peers join
      room.onPeerJoin((peerId: string) => {
        console.log('server: peer joined', peerId);
        sendRole({ role: 'server', ts: joinTs }, peerId);
      });

      // Clean up when peers leave
      room.onPeerLeave((peerId: string) => {
        console.log('server: peer left', peerId);
        cleanupIfEmpty();
        if (!streamCache) {
          options.onStateChange?.(ServerState.IDLE);
        }
      });

      console.log(`Server started with peer ID ${selfId}`);
    },

    disconnect: async (): Promise<void> => {
      return serializer(async () => {
        console.log('disconnecting server');
        if (!_room) return;
        options.onStateChange?.(ServerState.DISCONNECTED);
        await _room.leave();
        // Hack: wait for disconnect to complete - above await resolves too early.
        await wait(100);
        if (streamCache) {
          streamCache.getTracks().forEach(track => track.stop());
          streamCache = null;
        }
        console.log('server: disconnected');
        _room = null;
      });
    },
  };
};

export interface IConnectResult {
  stream: MediaStream;
  maxResolution: IResolution;
}

/**
 * Creates a stream client that can receive streams from the server
 */
export const createClient = (options: ClientOptions) => {
  let _room: Room | null = null;

  return {
    connect: async (): Promise<IConnectResult> => {
      const { room, sendRole, onRole, sendGetStream, onMaxResolution } =
        // Hack: trystero may return a room that is being destroyed if we leave and
        // then re-join the same without waiting for leave to complete. So serialize
        // join and leave.
        await serializer(async () => {
          const con = createConnection(options);
          _room = con.room;
          return con;
        });
      const joinTs = Date.now();
      let serverPeerId: string | null = null;
      options.onStateChange?.(ClientState.CONNECTING);

      // Create a single stable stream that will be returned and updated
      const outputStream = new MediaStream();

      // Handle role announcements
      onRole(({ role }: { role: string }, peerId: string) => {
        if (role === 'server') {
          console.log('client: got server', peerId);
          serverPeerId = peerId;
          options.onStateChange?.(ClientState.CONNECTED);
          sendGetStream(null, peerId);
        }
      });

      // Announce client role when peers join
      room.onPeerJoin((peerId: string) => {
        console.log('client: peer joined', peerId);
        sendRole({ role: 'client', ts: joinTs }, peerId);
      });

      // Handle peer leaving
      room.onPeerLeave((peerId: string) => {
        console.log('client: peer left', peerId);
        if (peerId === serverPeerId) {
          serverPeerId = null;
          options.onStateChange?.(ClientState.CONNECTING);
        }
      });

      let streamPromise = new Promise<MediaStream>(resolve => {
        if (!room) {
          throw new Error('Room connection failed');
        }

        // Handle incoming streams
        room.onPeerStream((incomingStream: MediaStream) => {
          // Remove existing tracks
          outputStream.getTracks().forEach(track => {
            outputStream.removeTrack(track);
            // Does not seem to get fired automatically.
            outputStream.dispatchEvent(
              new MediaStreamTrackEvent('removetrack', {
                track,
              })
            );
          });

          // Add new tracks from incoming stream
          incomingStream.getTracks().forEach(track => {
            outputStream.addTrack(track);
            // Does not seem to get fired automatically.
            outputStream.dispatchEvent(
              new MediaStreamTrackEvent('addtrack', {
                track,
              })
            );
          });

          options.onStateChange?.(ClientState.STREAMING);

          resolve(outputStream);
        });
        console.log(`Client started with peer ID ${selfId}`);
      });

      let maxResolutionPromise = new Promise<IResolution>(resolve => {
        onMaxResolution(({ width, height }: { width: number; height: number }) => {
          resolve({ width, height });
        });
      });

      return {
        stream: await streamPromise,
        maxResolution: await maxResolutionPromise,
      };
    },

    disconnect: async (): Promise<void> => {
      return serializer(async () => {
        console.log('disconnecting client');
        if (!_room) return;
        options.onStateChange?.(ClientState.DISCONNECTED);
        await _room.leave();
        // Hack: wait for disconnect to complete - above await resolves too early.
        await wait(1000);
        console.log('client: disconnected');
        _room = null;
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
  const [clientState, setClientState] = useState<ClientState>(ClientState.DISCONNECTED);
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
        const { stream } = await client.connect();
        setStream(stream);
      } catch (error) {
        console.error('Failed to connect:', error);
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
