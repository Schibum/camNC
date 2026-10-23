import {
  ClientMessage,
  CloseCode,
  KEEPALIVE_PING,
  KEEPALIVE_PONG,
  MAX_MESSAGE_BYTES,
  MAX_PEERS_PER_ROOM,
  ServerMessage,
} from '@wbcnc/webrtc-channel/signal-protocol';
import { DurableObject } from 'cloudflare:workers';
import type { Env } from './index';
import { rejectWebSocket } from './reject';

interface Attachment {
  peerId: string;
  role: string;
  joinedAt: number;
}

/** Sockets without a keep-alive ping for this long are considered dead. */
export const STALE_AFTER_MS = 90_000;

const RATE_PER_SEC = 50;
const RATE_BURST = 100;

/**
 * One instance per room. Relays join/leave/signal messages between the
 * room's WebSockets. Holds no storage: presence lives in the socket
 * attachments, so the object can hibernate between messages.
 */
export class SignalRoom extends DurableObject<Env> {
  // In-memory only, reset on hibernation which is fine for rate limiting.
  private buckets = new WeakMap<WebSocket, { tokens: number; at: number }>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Answered by the runtime without waking the object.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(KEEPALIVE_PING, KEEPALIVE_PONG));
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const peerId = url.searchParams.get('peer')!;
    const role = url.searchParams.get('role')!;

    this.closeStaleSockets();
    const previous = this.socketsOf(peerId);
    const others = this.openSockets().filter(ws => attachment(ws).peerId !== peerId);
    if (others.length >= MAX_PEERS_PER_ROOM) {
      return rejectWebSocket(CloseCode.RoomFull, 'room full');
    }

    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ peerId, role, joinedAt: Date.now() } satisfies Attachment);

    send(server, {
      t: 'welcome',
      self: peerId,
      peers: others.map(ws => ({ id: attachment(ws).peerId, role: attachment(ws).role })),
    });
    if (previous.length > 0) {
      // A reconnect that raced the old socket's close: others keep seeing the same peer.
      for (const ws of previous) ws.close(CloseCode.Replaced, 'replaced');
    } else {
      this.broadcast({ t: 'join', id: peerId, role }, server);
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    if (typeof message !== 'string' || message.length > MAX_MESSAGE_BYTES) {
      ws.close(1009, 'message too big or binary');
      return;
    }
    if (!this.takeToken(ws)) {
      send(ws, { t: 'error', code: 'rate-limited' });
      return;
    }
    let msg: ClientMessage;
    try {
      msg = JSON.parse(message);
    } catch {
      send(ws, { t: 'error', code: 'bad-message' });
      return;
    }
    if (msg?.t !== 'signal' || typeof msg.to !== 'string') {
      send(ws, { t: 'error', code: 'bad-message' });
      return;
    }
    const target = this.socketsOf(msg.to)[0];
    if (!target) {
      send(ws, { t: 'error', code: 'unknown-peer', to: msg.to });
      return;
    }
    send(target, { t: 'signal', from: attachment(ws).peerId, data: msg.data });
  }

  async webSocketClose(ws: WebSocket, code: number) {
    this.onGone(ws, code);
  }

  async webSocketError(ws: WebSocket) {
    this.onGone(ws, 1011);
  }

  private onGone(ws: WebSocket, code: number) {
    try {
      // Complete the close handshake (no-op if the runtime already did).
      ws.close(code === 1005 || code === 1006 ? 1000 : code, 'closed');
    } catch {
      // Already closed.
    }
    const { peerId } = attachment(ws);
    // Replaced by a newer socket of the same peer: nobody left.
    if (this.socketsOf(peerId).some(other => other !== ws)) return;
    this.broadcast({ t: 'leave', id: peerId }, ws);
  }

  private closeStaleSockets() {
    const now = Date.now();
    for (const ws of this.openSockets()) {
      const lastPing = this.ctx.getWebSocketAutoResponseTimestamp(ws)?.getTime() ?? attachment(ws).joinedAt;
      if (now - lastPing > STALE_AFTER_MS) {
        ws.close(1001, 'stale');
        this.onGone(ws, 1001);
      }
    }
  }

  private takeToken(ws: WebSocket): boolean {
    const now = Date.now();
    const b = this.buckets.get(ws) ?? { tokens: RATE_BURST, at: now };
    b.tokens = Math.min(RATE_BURST, b.tokens + ((now - b.at) / 1000) * RATE_PER_SEC);
    b.at = now;
    const ok = b.tokens >= 1;
    if (ok) b.tokens -= 1;
    this.buckets.set(ws, b);
    return ok;
  }

  private openSockets(): WebSocket[] {
    return this.ctx.getWebSockets().filter(ws => ws.readyState === WebSocket.OPEN);
  }

  private socketsOf(peerId: string): WebSocket[] {
    return this.openSockets().filter(ws => attachment(ws).peerId === peerId);
  }

  private broadcast(msg: ServerMessage, except?: WebSocket) {
    for (const ws of this.openSockets()) {
      if (ws !== except) send(ws, msg);
    }
  }
}

function attachment(ws: WebSocket): Attachment {
  return ws.deserializeAttachment() as Attachment;
}

function send(ws: WebSocket, msg: ServerMessage) {
  try {
    ws.send(JSON.stringify(msg));
  } catch {
    // Socket closing; its close handler cleans up.
  }
}
