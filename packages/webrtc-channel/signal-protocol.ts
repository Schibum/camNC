/**
 * Wire protocol between `WsSignaller` and the `apps/signal` Durable Object.
 * JSON text frames, versioned by the URL path:
 *   wss://<host>/v1/rooms/<roomId>?peer=<peerId>&role=<role>
 */

export const SIGNAL_PROTOCOL_PATH = '/v1/rooms/';

export const KEEPALIVE_PING = 'ping';
export const KEEPALIVE_PONG = 'pong';

/** Close codes sent by the server. Other codes (e.g. 1001 on a deploy) mean "reconnect". */
export const CloseCode = {
  /** A newer socket with the same peerId took over. */
  Replaced: 4001,
  RoomFull: 4003,
  BadRequest: 4400,
} as const;

export const MAX_PEERS_PER_ROOM = 16;
export const MAX_MESSAGE_BYTES = 64 * 1024;

export interface PeerInfo {
  peerId: string;
  role: string;
}

export type ServerMessage =
  | { t: 'welcome'; self: string; peers: { id: string; role: string }[] }
  | { t: 'join'; id: string; role: string }
  | { t: 'leave'; id: string }
  | { t: 'signal'; from: string; data: unknown }
  | { t: 'error'; code: 'unknown-peer' | 'bad-message' | 'rate-limited'; to?: string };

export type ClientMessage = { t: 'signal'; to: string; data: unknown };

const ROOM_ID_RE = /^[A-Za-z0-9_-]{43}$/;
const PEER_ID_RE = /^[A-Za-z0-9-]{8,64}$/;
const ROLE_RE = /^[a-z][a-z0-9-]{0,31}$/;

export const isValidRoomId = (s: string) => ROOM_ID_RE.test(s);
export const isValidPeerId = (s: string) => PEER_ID_RE.test(s);
export const isValidRole = (s: string) => ROLE_RE.test(s);

/**
 * Derives the public room id from the secret access token, so the token itself
 * never reaches the signalling server or its logs.
 */
export async function roomIdFromToken(accessToken: string): Promise<string> {
  const bytes = new TextEncoder().encode(`camnc-room-v1:${accessToken}`);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  let bin = '';
  for (const b of digest) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
