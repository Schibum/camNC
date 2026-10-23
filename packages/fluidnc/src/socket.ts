import mitt from 'mitt';

/**
 * How we talk to the controller:
 * - `v4`: FluidNC 4.x, ESPAsyncWebServer socket on the HTTP port (`ws://host/?independent_session`).
 * - `v3-81`: FluidNC 3.9.x, the WebUI v2 socket on HTTP port + 1. Never port + 2: that one kicks every other client.
 */
export type FirmwareVariant = 'v4' | 'v3-81';

export type SocketState = 'idle' | 'connecting' | 'open' | 'closed';

export type SocketEvents = {
  state: SocketState;
  /** Fired once a socket is open, before any line is delivered. */
  open: { variant: FirmwareVariant; url: string };
  /** The socket closed, or every connection attempt in a round failed (`wasOpen: false`). */
  close: { wasOpen: boolean; reason: string };
  /** One complete line of controller output, without the line terminator. */
  line: string;
  /** Raw bytes of controller output, delivered before they are split into lines. */
  data: Uint8Array;
  /** Text control frames (`currentID:1`, `PING:…`). */
  control: string;
};

export interface FluidncSocketOptions {
  /** IP address or `.local` name, optionally with the HTTP port, e.g. `192.168.1.20` or `127.0.0.1:8848`. */
  host: string;
  /** Variant remembered from an earlier connection. It is tried first; detection falls back to the other one. */
  variant?: FirmwareVariant;
  /** Allows injecting a fake for tests. Defaults to the global `WebSocket`. */
  WebSocketImpl?: typeof WebSocket;
  connectTimeoutMs?: number;
  /** Close the socket when nothing at all was received for this long. Callers are expected to poll `?`. */
  staleTimeoutMs?: number;
  /** Interval for `PING:` keepalives on v4. 3.9.9 would treat `PING:` as G-code, so it never gets them. */
  pingIntervalMs?: number;
  /** Reconnect backoff in ms, as `[initial, max]`. */
  backoffMs?: [number, number];
}

/** Strip schemes, paths and whitespace from what a user typed in the host field. */
export function normalizeHost(input: string): string {
  let host = input.trim();
  host = host.replace(/^[a-z]+:\/\//i, '');
  const end = host.search(/[/?#]/);
  if (end !== -1) host = host.slice(0, end);
  return host;
}

export function socketUrl(host: string, variant: FirmwareVariant): string {
  const url = new URL(`http://${normalizeHost(host)}`);
  if (variant === 'v4') return `ws://${url.host}/?independent_session`;
  const httpPort = url.port ? Number(url.port) : 80;
  return `ws://${url.hostname}:${httpPort + 1}/`;
}

export function httpUrl(host: string, path: string): string {
  return `http://${normalizeHost(host)}${path}`;
}

/**
 * A raw connection to FluidNC: variant detection, line splitting, keepalive and reconnects.
 *
 * Reconnecting only restores the *connection*. Nothing that was sent before is replayed;
 * that is the job (and the responsibility) of the layer above.
 */
export class FluidncSocket {
  private readonly events = mitt<SocketEvents>();
  public readonly on = this.events.on;
  public readonly off = this.events.off;

  public state: SocketState = 'idle';
  public variant: FirmwareVariant | undefined;

  private ws: WebSocket | null = null;
  private running = false;
  private decoder = new TextDecoder();
  private partial = '';
  private lastDataAt = 0;
  private timers: ReturnType<typeof setInterval>[] = [];
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private backoff: number;
  private readonly opts: Required<Omit<FluidncSocketOptions, 'variant'>>;

  constructor(options: FluidncSocketOptions) {
    this.variant = options.variant;
    this.opts = {
      host: normalizeHost(options.host),
      WebSocketImpl: options.WebSocketImpl ?? globalThis.WebSocket,
      connectTimeoutMs: options.connectTimeoutMs ?? 4000,
      staleTimeoutMs: options.staleTimeoutMs ?? 8000,
      pingIntervalMs: options.pingIntervalMs ?? 10_000,
      backoffMs: options.backoffMs ?? [500, 10_000],
    };
    this.backoff = this.opts.backoffMs[0];
  }

  get host() {
    return this.opts.host;
  }

  /** Connect and keep reconnecting until `stop()`. */
  start() {
    if (this.running) return;
    this.running = true;
    void this.connectRound();
  }

  stop() {
    this.running = false;
    clearTimeout(this.reconnectTimer);
    this.teardown('stopped');
    this.setState('idle');
  }

  isOpen() {
    return this.state === 'open' && this.ws?.readyState === 1;
  }

  /** Send text or bytes. Everything goes out as binary: text frames starting with `PING:` are special on v4. */
  send(data: string | Uint8Array) {
    if (!this.isOpen()) throw new Error('FluidNC socket is not connected');
    const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
    this.ws!.send(bytes);
  }

  /** Drop a partial line, e.g. binary handshake bytes left over from XMODEM. */
  resetLineBuffer() {
    this.partial = '';
  }

  private setState(state: SocketState) {
    if (this.state === state) return;
    this.state = state;
    this.events.emit('state', state);
  }

  private candidates(): FirmwareVariant[] {
    if (this.variant === 'v3-81') return ['v3-81', 'v4'];
    return ['v4', 'v3-81'];
  }

  private async connectRound() {
    if (!this.running) return;
    this.setState('connecting');
    let lastError = 'unreachable';
    for (const variant of this.candidates()) {
      try {
        const url = socketUrl(this.opts.host, variant);
        const ws = await this.tryOpen(url);
        if (!this.running) {
          ws.close();
          return;
        }
        this.attach(ws, variant, url);
        return;
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
      }
    }
    this.events.emit('close', { wasOpen: false, reason: lastError });
    this.scheduleReconnect();
  }

  private tryOpen(url: string): Promise<WebSocket> {
    return new Promise((resolve, reject) => {
      let ws: WebSocket;
      try {
        ws = new this.opts.WebSocketImpl(url);
      } catch (err) {
        reject(err);
        return;
      }
      ws.binaryType = 'arraybuffer';
      const timer = setTimeout(() => {
        cleanup();
        ws.close();
        reject(new Error('timeout'));
      }, this.opts.connectTimeoutMs);
      const onOpen = () => {
        cleanup();
        resolve(ws);
      };
      const onFail = () => {
        cleanup();
        reject(new Error('unreachable'));
      };
      const cleanup = () => {
        clearTimeout(timer);
        ws.removeEventListener('open', onOpen);
        ws.removeEventListener('error', onFail);
        ws.removeEventListener('close', onFail);
      };
      ws.addEventListener('open', onOpen);
      ws.addEventListener('error', onFail);
      ws.addEventListener('close', onFail);
    });
  }

  private attach(ws: WebSocket, variant: FirmwareVariant, url: string) {
    this.ws = ws;
    this.variant = variant;
    this.decoder = new TextDecoder();
    this.partial = '';
    this.lastDataAt = Date.now();
    this.backoff = this.opts.backoffMs[0];

    ws.addEventListener('message', this.onMessage);
    ws.addEventListener('close', this.onClose);
    ws.addEventListener('error', this.onError);

    this.timers.push(
      setInterval(() => {
        if (Date.now() - this.lastDataAt > this.opts.staleTimeoutMs) {
          this.teardown('stale');
          this.afterClose('no data received');
        }
      }, 1000)
    );
    if (variant === 'v4') {
      this.timers.push(
        setInterval(() => {
          if (this.ws?.readyState === 1) this.ws.send('PING:');
        }, this.opts.pingIntervalMs)
      );
    }
    this.setState('open');
    this.events.emit('open', { variant, url });
  }

  private onMessage = (event: MessageEvent) => {
    this.lastDataAt = Date.now();
    if (typeof event.data === 'string') {
      this.events.emit('control', event.data);
      return;
    }
    const bytes = new Uint8Array(event.data as ArrayBuffer);
    this.events.emit('data', bytes);
    this.pushText(this.decoder.decode(bytes, { stream: true }));
  };

  private pushText(text: string) {
    const parts = (this.partial + text).split('\n');
    this.partial = parts.pop() ?? '';
    for (const part of parts) {
      const line = part.replace(/\r$/, '');
      if (line.length) this.events.emit('line', line);
    }
  }

  private onError = () => {
    // A `close` event always follows.
  };

  private onClose = () => {
    this.teardown('closed');
    this.afterClose('connection closed');
  };

  private afterClose(reason: string) {
    this.events.emit('close', { wasOpen: true, reason });
    this.scheduleReconnect();
  }

  private teardown(_reason: string) {
    for (const timer of this.timers) clearInterval(timer);
    this.timers = [];
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      ws.removeEventListener('message', this.onMessage);
      ws.removeEventListener('close', this.onClose);
      ws.removeEventListener('error', this.onError);
      if (ws.readyState === 0 || ws.readyState === 1) ws.close();
    }
    if (this.state === 'open' || this.state === 'connecting') this.setState('closed');
  }

  private scheduleReconnect() {
    if (!this.running) return;
    this.setState('closed');
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => void this.connectRound(), this.backoff);
    this.backoff = Math.min(this.backoff * 2, this.opts.backoffMs[1]);
  }
}
