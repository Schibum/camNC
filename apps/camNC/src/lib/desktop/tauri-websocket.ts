import { Channel, invoke } from '@tauri-apps/api/core';

/** Messages of Tauri's websocket plugin (`tauri-plugin-websocket`). */
type PluginMessage =
  | { type: 'Text'; data: string }
  | { type: 'Binary' | 'Ping' | 'Pong'; data: number[] }
  | { type: 'Close'; data: { code: number; reason: string } | null };

/** The plugin reports a broken connection as a plain error string on the message channel. */
type ChannelMessage = PluginMessage | string;

/** How long `close()` waits for the server's close frame before reporting the socket closed anyway. */
const kCloseTimeoutMs = 2000;

/**
 * A browser-like `WebSocket` whose connection is made by the desktop app's Rust side, so a `ws://` controller on
 * the LAN works on every webview engine, without mixed-content blocking or a local network permission.
 *
 * It implements what `FluidncSocket` uses: `readyState`, `binaryType = 'arraybuffer'`, `send`, `close` and the
 * `open`/`message`/`error`/`close` events. Sends are queued, so the controller gets them in order.
 */
export class TauriWebSocket extends EventTarget {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  readyState = TauriWebSocket.CONNECTING;
  /** Binary messages are always delivered as `ArrayBuffer`. */
  binaryType: BinaryType = 'arraybuffer';
  private id: number | null = null;
  private queue: Promise<void> = Promise.resolve();
  private closeTimer: ReturnType<typeof setTimeout> | undefined;
  /** Messages that arrived before the connect call returned, delivered right after `open` like a browser would. */
  private early: ChannelMessage[] = [];

  constructor(readonly url: string) {
    super();
    // The channel is listening before the connection exists, so a greeting sent right after the handshake is kept.
    const channel = new Channel<ChannelMessage>();
    channel.onmessage = message => {
      if (this.readyState === TauriWebSocket.CONNECTING) this.early.push(message);
      else this.receive(message);
    };
    invoke<number>('plugin:websocket|connect', { url, onMessage: channel }).then(
      id => {
        this.id = id;
        if (this.readyState === TauriWebSocket.CLOSING) {
          // close() was called while connecting.
          this.sendClose(1000, '');
          return;
        }
        this.readyState = TauriWebSocket.OPEN;
        this.dispatchEvent(new Event('open'));
        const early = this.early;
        this.early = [];
        early.forEach(message => this.receive(message));
      },
      () => {
        this.dispatchEvent(new Event('error'));
        this.finish(1006, '', false);
      }
    );
  }

  send(data: string | ArrayBuffer | ArrayBufferView) {
    if (this.readyState !== TauriWebSocket.OPEN) throw new DOMException('WebSocket is not open', 'InvalidStateError');
    if (typeof data === 'string') {
      this.post({ type: 'Text', data });
    } else {
      const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
      this.post({ type: 'Binary', data: Array.from(bytes) });
    }
  }

  close(code = 1000, reason = '') {
    if (this.readyState === TauriWebSocket.CLOSING || this.readyState === TauriWebSocket.CLOSED) return;
    const connecting = this.readyState === TauriWebSocket.CONNECTING;
    this.readyState = TauriWebSocket.CLOSING;
    if (!connecting) this.sendClose(code, reason);
  }

  private sendClose(code: number, reason: string) {
    this.post({ type: 'Close', data: { code, reason } });
    this.closeTimer = setTimeout(() => this.finish(code, reason, true), kCloseTimeoutMs);
  }

  private post(message: PluginMessage) {
    const id = this.id;
    this.queue = this.queue
      .then(() => invoke<void>('plugin:websocket|send', { id, message }))
      .catch(() => {
        // A failed write means the connection is gone.
        if (this.readyState !== TauriWebSocket.CLOSED) {
          this.dispatchEvent(new Event('error'));
          this.finish(1006, '', false);
        }
      });
  }

  private receive(message: ChannelMessage) {
    if (this.readyState === TauriWebSocket.CLOSED) return;
    if (typeof message === 'string') {
      this.dispatchEvent(new Event('error'));
      this.finish(1006, message, false);
      return;
    }
    switch (message.type) {
      case 'Text':
        this.dispatchEvent(new MessageEvent('message', { data: message.data }));
        break;
      case 'Binary':
        this.dispatchEvent(new MessageEvent('message', { data: new Uint8Array(message.data).buffer }));
        break;
      case 'Close':
        this.finish(message.data?.code ?? 1005, message.data?.reason ?? '', message.data !== null);
        break;
    }
  }

  private finish(code: number, reason: string, wasClean: boolean) {
    if (this.readyState === TauriWebSocket.CLOSED) return;
    clearTimeout(this.closeTimer);
    this.readyState = TauriWebSocket.CLOSED;
    this.dispatchEvent(new CloseEvent('close', { code, reason, wasClean }));
  }
}
