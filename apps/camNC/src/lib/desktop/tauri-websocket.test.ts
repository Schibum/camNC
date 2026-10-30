import { clearMocks, mockIPC } from '@tauri-apps/api/mocks';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TauriWebSocket } from './tauri-websocket';

type Sent = { id: number; message: { type: string; data: unknown } };

/** A fake of the websocket plugin's two commands. `push` delivers a message as the Rust side would. */
function fakePlugin({ failConnect = false } = {}) {
  const sent: Sent[] = [];
  let onMessage: ((message: unknown) => void) | undefined;
  let resolveConnect: () => void = () => {};
  mockIPC(async (cmd, args) => {
    const payload = args as Record<string, unknown>;
    if (cmd === 'plugin:websocket|connect') {
      onMessage = (payload.onMessage as { onmessage: (m: unknown) => void }).onmessage;
      if (failConnect) throw 'connection refused';
      await new Promise<void>(resolve => (resolveConnect = resolve));
      return 7;
    }
    if (cmd === 'plugin:websocket|send') {
      sent.push(payload as unknown as Sent);
      return null;
    }
    throw new Error(`unexpected command ${cmd}`);
  });
  return {
    sent,
    push: (message: unknown) => onMessage!(message),
    open: () => resolveConnect(),
  };
}

function nextEvent(ws: EventTarget, type: string) {
  return new Promise<Event>(resolve => ws.addEventListener(type, resolve, { once: true }));
}

describe('TauriWebSocket', () => {
  beforeEach(() => clearMocks());
  afterEach(() => clearMocks());

  it('opens, then delivers messages that arrived during the handshake', async () => {
    const plugin = fakePlugin();
    const ws = new TauriWebSocket('ws://192.168.1.20/');
    const received: unknown[] = [];
    await Promise.resolve();
    plugin.push({ type: 'Text', data: 'CURRENT_ID:1' });
    const opened = nextEvent(ws, 'open');
    ws.addEventListener('open', () => ws.addEventListener('message', e => received.push((e as MessageEvent).data)));
    plugin.open();
    await opened;
    expect(ws.readyState).toBe(TauriWebSocket.OPEN);
    expect(received).toEqual(['CURRENT_ID:1']);

    plugin.push({ type: 'Binary', data: [111, 107] });
    const data = received[1] as ArrayBuffer;
    expect(new TextDecoder().decode(data)).toBe('ok');
  });

  it('sends binary frames in order', async () => {
    const plugin = fakePlugin();
    const ws = new TauriWebSocket('ws://192.168.1.20/');
    const opened = nextEvent(ws, 'open');
    await Promise.resolve();
    plugin.open();
    await opened;
    ws.send(new TextEncoder().encode('G0 X1\n'));
    ws.send(new TextEncoder().encode('G0 X2\n'));
    ws.send('PING:');
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(plugin.sent.map(s => s.id)).toEqual([7, 7, 7]);
    expect(plugin.sent.map(s => s.message)).toEqual([
      { type: 'Binary', data: Array.from(new TextEncoder().encode('G0 X1\n')) },
      { type: 'Binary', data: Array.from(new TextEncoder().encode('G0 X2\n')) },
      { type: 'Text', data: 'PING:' },
    ]);
  });

  it('reports a failed connection as error, then close', async () => {
    fakePlugin({ failConnect: true });
    const ws = new TauriWebSocket('ws://192.168.1.99/');
    const events: string[] = [];
    ws.addEventListener('error', () => events.push('error'));
    const closed = nextEvent(ws, 'close');
    ws.addEventListener('close', () => events.push('close'));
    const event = (await closed) as CloseEvent;
    expect(events).toEqual(['error', 'close']);
    expect(event.wasClean).toBe(false);
    expect(ws.readyState).toBe(TauriWebSocket.CLOSED);
  });

  it('closes with a close frame and finishes on the server echo', async () => {
    const plugin = fakePlugin();
    const ws = new TauriWebSocket('ws://192.168.1.20/');
    const opened = nextEvent(ws, 'open');
    await Promise.resolve();
    plugin.open();
    await opened;
    const closed = nextEvent(ws, 'close');
    ws.close();
    expect(ws.readyState).toBe(TauriWebSocket.CLOSING);
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(plugin.sent.at(-1)!.message).toEqual({ type: 'Close', data: { code: 1000, reason: '' } });
    plugin.push({ type: 'Close', data: { code: 1000, reason: '' } });
    expect(((await closed) as CloseEvent).wasClean).toBe(true);
  });

  it('treats an error from the connection as a dropped socket', async () => {
    const plugin = fakePlugin();
    const ws = new TauriWebSocket('ws://192.168.1.20/');
    const opened = nextEvent(ws, 'open');
    await Promise.resolve();
    plugin.open();
    await opened;
    const closed = nextEvent(ws, 'close');
    plugin.push('IO error: Connection reset by peer');
    const event = (await closed) as CloseEvent;
    expect(event.code).toBe(1006);
    expect(event.wasClean).toBe(false);
  });

  it('also reports events to on… handlers, as the signaller uses them', async () => {
    const plugin = fakePlugin();
    const ws = new TauriWebSocket('wss://signal.camnc.app/');
    const seen: string[] = [];
    ws.onopen = () => seen.push('open');
    ws.onmessage = e => seen.push(`message ${e.data}`);
    ws.onclose = e => seen.push(`close ${e.code}`);
    await Promise.resolve();
    const closed = nextEvent(ws, 'close');
    plugin.open();
    await nextEvent(ws, 'open');
    plugin.push({ type: 'Text', data: 'hi' });
    plugin.push({ type: 'Close', data: { code: 1000, reason: '' } });
    await closed;
    expect(seen).toEqual(['open', 'message hi', 'close 1000']);
  });
});
