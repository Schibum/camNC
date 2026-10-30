import { SIGNAL_URL } from '@wbcnc/public-config/signal';
import log from 'loglevel';
import mitt, { Emitter } from 'mitt';
import { CloseCode, KEEPALIVE_PING, KEEPALIVE_PONG, roomIdFromToken, SIGNAL_PROTOCOL_PATH, type ServerMessage } from './signal-protocol';
import { generatePeerId, type Signaller, type SignallerEvents } from './signaller';

export interface WsSignallerOptions {
  /** Base URL of the signal worker, defaults to `defaultSignalUrl()`. */
  url?: string;
  pingIntervalMs?: number;
  pongTimeoutMs?: number;
  maxReconnectDelayMs?: number;
  /** For tests. */
  WebSocketImpl?: typeof WebSocket;
}

let defaultWebSocketImpl: typeof WebSocket | undefined;

/**
 * The WebSocket class signallers use unless `WebSocketImpl` is given. The desktop app connects through its native side,
 * because the signal worker only accepts the web app's origins.
 */
export function setSignalWebSocket(impl: typeof WebSocket | undefined) {
  defaultWebSocketImpl = impl;
}

/** `SIGNAL_URL`, or `?signalUrl=ws://localhost:8787` to test against a local `wrangler dev`. */
export function defaultSignalUrl(): string {
  return new URLSearchParams(globalThis.location?.search ?? '').get('signalUrl') ?? SIGNAL_URL;
}

const FATAL_CLOSE_CODES: number[] = [CloseCode.Replaced, CloseCode.RoomFull, CloseCode.BadRequest];
const MAX_OUTBOX = 200;

/**
 * Signalling over a WebSocket to the `apps/signal` Durable Object. Keeps the
 * socket open and reconnects with the same peerId, so other peers see no
 * leave/join for short drops.
 */
export class WsSignaller implements Signaller {
  public readonly peerId = generatePeerId();
  public readonly on: Emitter<SignallerEvents>['on'];
  public readonly off: Emitter<SignallerEvents>['off'];
  private readonly emit: Emitter<SignallerEvents>['emit'];

  private ws?: WebSocket;
  private url?: string;
  private welcomed = false;
  private stopped = false;
  private attempt = 0;
  /** Peers currently in the room, peerId -> role. */
  private present = new Map<string, string>();
  private outbox: string[] = [];
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private pingTimer?: ReturnType<typeof setInterval>;
  private pongTimer?: ReturnType<typeof setTimeout>;
  private settleJoin?: (err?: Error) => void;

  constructor(private readonly opts: WsSignallerOptions = {}) {
    const bus = mitt<SignallerEvents>();
    this.on = bus.on;
    this.off = bus.off;
    this.emit = bus.emit;
  }

  async join(accessToken: string, role: string): Promise<void> {
    if (this.url) throw new Error('This instance already joined a room');
    const roomId = await roomIdFromToken(accessToken);
    if (this.stopped) return; // disconnect() was called while hashing.
    const base = (this.opts.url ?? defaultSignalUrl()).replace(/\/+$/, '');
    this.url = `${base}${SIGNAL_PROTOCOL_PATH}${roomId}?peer=${encodeURIComponent(this.peerId)}&role=${encodeURIComponent(role)}`;
    globalThis.addEventListener?.('online', this.reconnectNow);
    globalThis.document?.addEventListener('visibilitychange', this.reconnectNow);
    return new Promise<void>((resolve, reject) => {
      this.settleJoin = err => {
        this.settleJoin = undefined;
        if (err) reject(err);
        else resolve();
      };
      this.connect();
    });
  }

  async sendMessage(targetPeerId: string, data: unknown): Promise<void> {
    const frame = JSON.stringify({ t: 'signal', to: targetPeerId, data });
    if (this.ws?.readyState === WebSocket.OPEN && this.welcomed) {
      this.ws.send(frame);
    } else if (this.outbox.length < MAX_OUTBOX) {
      this.outbox.push(frame);
    }
  }

  async disconnect(): Promise<void> {
    this.stopped = true;
    globalThis.removeEventListener?.('online', this.reconnectNow);
    globalThis.document?.removeEventListener('visibilitychange', this.reconnectNow);
    clearTimeout(this.reconnectTimer);
    this.dropSocket(1000);
    this.present.clear();
    this.outbox.length = 0;
    this.settleJoin?.();
  }

  private connect() {
    if (this.stopped || !this.url) return;
    const WS = this.opts.WebSocketImpl ?? defaultWebSocketImpl ?? WebSocket;
    const ws = new WS(this.url);
    this.ws = ws;
    this.welcomed = false;
    ws.onmessage = ev => {
      if (ws !== this.ws) return;
      if (ev.data === KEEPALIVE_PONG) {
        clearTimeout(this.pongTimer);
        return;
      }
      let msg: ServerMessage;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      this.onServerMessage(msg);
    };
    ws.onclose = ev => {
      if (ws !== this.ws) return;
      log.debug('signal socket closed', ev.code, ev.reason);
      this.dropSocket();
      if (FATAL_CLOSE_CODES.includes(ev.code)) {
        this.stopped = true;
        this.settleJoin?.(new Error(`Signalling closed: ${ev.code} ${ev.reason}`));
        return;
      }
      // Don't block callers while the server is unreachable, keep trying in the background.
      this.settleJoin?.();
      this.scheduleReconnect();
    };
  }

  private onServerMessage(msg: ServerMessage) {
    switch (msg.t) {
      case 'welcome': {
        this.welcomed = true;
        this.attempt = 0;
        const ids = new Set(msg.peers.map(p => p.id));
        // Peers that left while we were disconnected.
        for (const id of [...this.present.keys()]) {
          if (!ids.has(id)) this.removePeer(id);
        }
        for (const p of msg.peers) this.addPeer(p.id, p.role);
        for (const frame of this.outbox.splice(0)) this.ws!.send(frame);
        this.startPing();
        this.settleJoin?.();
        break;
      }
      case 'join':
        this.addPeer(msg.id, msg.role);
        break;
      case 'leave':
        this.removePeer(msg.id);
        break;
      case 'signal':
        this.emit('signal', { from: msg.from, data: msg.data });
        break;
      case 'error':
        log.debug('signal server error', msg);
        break;
    }
  }

  private addPeer(peerId: string, role: string) {
    if (peerId === this.peerId || this.present.has(peerId)) return;
    this.present.set(peerId, role);
    this.emit('peer-joined', { peerId, role });
  }

  private removePeer(peerId: string) {
    if (this.present.delete(peerId)) this.emit('peer-left', { peerId });
  }

  private startPing() {
    clearInterval(this.pingTimer);
    this.pingTimer = setInterval(() => {
      if (this.ws?.readyState !== WebSocket.OPEN) return;
      this.ws.send(KEEPALIVE_PING);
      clearTimeout(this.pongTimer);
      this.pongTimer = setTimeout(() => {
        log.debug('signal socket: pong timeout');
        this.dropSocket(1000);
        this.scheduleReconnect(0);
      }, this.opts.pongTimeoutMs ?? 10_000);
    }, this.opts.pingIntervalMs ?? 30_000);
  }

  /** Detaches and closes the current socket without triggering its close handler. */
  private dropSocket(code?: number) {
    clearInterval(this.pingTimer);
    clearTimeout(this.pongTimer);
    const ws = this.ws;
    this.ws = undefined;
    this.welcomed = false;
    if (ws && code !== undefined && ws.readyState <= WebSocket.OPEN) ws.close(code);
  }

  private scheduleReconnect(delayMs?: number) {
    if (this.stopped) return;
    clearTimeout(this.reconnectTimer);
    const max = this.opts.maxReconnectDelayMs ?? 10_000;
    const delay = delayMs ?? Math.min(max, 500 * 2 ** this.attempt) * (0.5 + Math.random() / 2);
    this.attempt++;
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
  }

  private reconnectNow = () => {
    if (this.stopped || this.ws || globalThis.document?.visibilityState === 'hidden') return;
    this.scheduleReconnect(0);
  };
}
