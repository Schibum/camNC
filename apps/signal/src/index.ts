import { CloseCode, isValidPeerId, isValidRole, isValidRoomId, SIGNAL_PROTOCOL_PATH } from '@wbcnc/webrtc-channel/signal-protocol';
import { isOriginAllowed } from './origin';
import { rejectWebSocket } from './reject';

export { SignalRoom } from './room';

export interface Env {
  ROOMS: DurableObjectNamespace;
  /** Comma separated origins or `*` patterns, see `isOriginAllowed`. */
  ALLOWED_ORIGINS: string;
  /** Optional: per-IP limit on new connections. */
  CONNECT_LIMITER?: RateLimit;
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith(SIGNAL_PROTOCOL_PATH)) {
      return new Response(url.pathname === '/' ? 'camnc-signal' : 'Not found', { status: url.pathname === '/' ? 200 : 404 });
    }
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('Expected WebSocket upgrade', { status: 426 });
    }
    if (!isOriginAllowed(request.headers.get('Origin'), env.ALLOWED_ORIGINS)) {
      return new Response('Origin not allowed', { status: 403 });
    }

    const roomId = url.pathname.slice(SIGNAL_PROTOCOL_PATH.length);
    const peerId = url.searchParams.get('peer') ?? '';
    const role = url.searchParams.get('role') ?? '';
    if (!isValidRoomId(roomId) || !isValidPeerId(peerId) || !isValidRole(role)) {
      // Close with a code after accepting, browsers don't expose HTTP status codes of failed upgrades.
      return rejectWebSocket(CloseCode.BadRequest, 'bad request');
    }

    if (env.CONNECT_LIMITER) {
      const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
      const { success } = await env.CONNECT_LIMITER.limit({ key: ip });
      if (!success) return new Response('Too many connections', { status: 429 });
    }

    const stub = env.ROOMS.get(env.ROOMS.idFromName(roomId));
    return stub.fetch(request);
  },
} satisfies ExportedHandler<Env>;
