import createChunkedPort from '@wbcnc/webrtc-channel/data-chunker';
import Peer from '@wbcnc/webrtc-channel/peer';
import { RolePeering } from '@wbcnc/webrtc-channel/role-peering';
import * as Comlink from 'comlink';
import log from 'loglevel';
import { useEffect, useRef, useState } from 'react';
import { createSerializer } from './asyncSerializer';

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

export interface ServerOptions {
  accessToken: string;
  streamFactory: () => Promise<MediaStream>;
  multipleStreams?: boolean;
  onStateChange?: (state: ServerState) => void;
}

export interface ClientOptions {
  accessToken: string;
  onStateChange?: (state: ClientState) => void;
}

export interface IResolution {
  width: number;
  height: number;
}

async function getMaxResolution(stream: MediaStream) {
  const track = stream.getVideoTracks()[0];
  if (!track) throw new Error('No video track found');
  let width = track.getSettings().width;
  let height = track.getSettings().height;
  if (!width || !height) throw new Error('No width or height found');
  if (width > height) [width, height] = [height, width];
  return { width, height };
}

export const createServer = (options: ServerOptions) => {
  let peering = new RolePeering(options.accessToken, 'server', 'client');
  let streamCache: MediaStream | null = null;
  let streamPromise: Promise<MediaStream> | null = null;
  const peers = new Map<string, Peer>();

  function cleanupStream() {
    if (streamCache) {
      streamCache.getTracks().forEach(t => t.stop());
      streamCache = null;
    }
  }

  function cleanupIfEmpty() {
    if (peers.size === 0) cleanupStream();
  }

  async function getStream(): Promise<MediaStream> {
    if (streamCache) return streamCache;
    if (streamPromise) return streamPromise;
    streamPromise = options.streamFactory();
    streamCache = await streamPromise;
    streamPromise = null;
    return streamCache;
  }

  function exposeToPeer(peer: Peer) {
    const port = createChunkedPort(peer.dataChannel);
    const api = {
      getStream: async (): Promise<IResolution> => {
        const stream = await getStream();
        stream.getTracks().forEach(track => peer.pc.addTrack(track, stream));
        options.onStateChange?.(ServerState.STREAMING);
        return getMaxResolution(stream);
      },
    };
    Comlink.expose(api, port);
  }

  peering.on('peerConnected', ({ peerId, peer }: { peerId: string; peer: Peer }) => {
    log.debug('peerConnected', peerId);
    peers.set(peerId, peer);
    peer.on('close', () => {
      peers.delete(peerId);
      cleanupIfEmpty();
    });
    exposeToPeer(peer);
  });

  return {
    connect: async () => {
      await peering.join();
      options.onStateChange?.(ServerState.IDLE);
    },
    disconnect: async () => {
      await peering.destroy();
      cleanupStream();
      options.onStateChange?.(ServerState.DISCONNECTED);
    },
  };
};

export interface IConnectResult {
  stream: MediaStream;
  maxResolution: IResolution;
}

export const createClient = (options: ClientOptions) => {
  let peering = new RolePeering(options.accessToken, 'client', 'server', {
    maxPeers: 1,
  });
  let serverPeer: Peer | null = null;

  return {
    connect: async (): Promise<IConnectResult> => {
      options.onStateChange?.(ClientState.CONNECTING);
      await peering.join();

      const outputStream = new MediaStream();
      let resolveStream: (s: MediaStream) => void;
      const streamPromise = new Promise<MediaStream>(res => {
        resolveStream = res;
      });
      let resolveRes: (r: IResolution) => void;
      const resPromise = new Promise<IResolution>(res => {
        resolveRes = res;
      });

      peering.on('peerConnected', async ({ peerId, peer }: { peerId: string; peer: Peer }) => {
        serverPeer = peer;
        peer.on('close', () => {
          serverPeer = null;
          options.onStateChange?.(ClientState.CONNECTING);
        });
        const port = createChunkedPort(peer.dataChannel);
        const remote = Comlink.wrap<{ getStream: () => Promise<IResolution> }>(port);
        peer.pc.addEventListener('track', (ev: RTCTrackEvent) => {
          outputStream.getTracks().forEach(t => {
            outputStream.removeTrack(t);
            outputStream.dispatchEvent(new MediaStreamTrackEvent('removetrack', { track: t }));
          });
          const stream = ev.streams[0];
          const tracks = stream ? stream.getTracks() : [ev.track];
          tracks.forEach((track: MediaStreamTrack) => {
            outputStream.addTrack(track);
            outputStream.dispatchEvent(new MediaStreamTrackEvent('addtrack', { track }));
          });
          resolveStream(outputStream);
        });
        options.onStateChange?.(ClientState.CONNECTED);
        resolveRes(await remote.getStream());
      });

      return {
        stream: await streamPromise,
        maxResolution: await resPromise,
      };
    },
    disconnect: async () => {
      await peering.destroy();
      serverPeer = null;
      options.onStateChange?.(ClientState.DISCONNECTED);
    },
  };
};

// Global serializer guarantees that connect / disconnect operations run sequentially
const serialize = createSerializer();

export function useTrysteroServer(options: ServerOptions) {
  const [serverState, setServerState] = useState<ServerState>(ServerState.IDLE);
  const serverRef = useRef<ReturnType<typeof createServer> | null>(null);

  useEffect(() => {
    const srv = createServer({
      ...options,
      onStateChange: setServerState,
    });
    serverRef.current = srv;
    serialize(() => srv.connect());

    return () => {
      serialize(() => srv.disconnect());
      if (serverRef.current === srv) serverRef.current = null;
    };
  }, [options.accessToken]);

  return {
    serverState,
    disconnect: () => serverRef.current?.disconnect(),
  };
}

export function useTrysteroClient(options: ClientOptions) {
  const [clientState, setClientState] = useState<ClientState>(ClientState.DISCONNECTED);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const clientRef = useRef<ReturnType<typeof createClient> | null>(null);

  useEffect(() => {
    const cl = createClient({
      ...options,
      onStateChange: setClientState,
    });
    clientRef.current = cl;

    serialize(async () => {
      try {
        const { stream } = await cl.connect();
        setStream(stream);
      } catch (error) {
        console.error('Failed to connect:', error);
      }
    });

    return () => {
      serialize(() => cl.disconnect());
      if (clientRef.current === cl) clientRef.current = null;
      setStream(null);
    };
  }, [options.accessToken]);

  return {
    clientState,
    stream,
    disconnect: () => clientRef.current?.disconnect(),
  };
}
