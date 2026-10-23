import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CloseCode, roomIdFromToken } from './signal-protocol';
import { WsSignaller } from './ws-signaller';

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  readyState: number = WebSocket.CONNECTING;
  sent: string[] = [];
  closedWith?: number;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onclose: ((ev: { code: number; reason: string }) => void) | null = null;
  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this);
  }
  send(data: string) {
    this.sent.push(data);
  }
  close(code?: number) {
    this.closedWith = code;
    this.readyState = WebSocket.CLOSED;
  }
  // Test helpers acting as the server.
  welcome(peers: { id: string; role: string }[] = []) {
    this.readyState = WebSocket.OPEN;
    this.receive({ t: 'welcome', self: 'me', peers });
  }
  receive(msg: unknown) {
    this.onmessage?.({ data: typeof msg === 'string' ? msg : JSON.stringify(msg) });
  }
  serverClose(code: number) {
    this.readyState = WebSocket.CLOSED;
    this.onclose?.({ code, reason: '' });
  }
}

const last = () => FakeWebSocket.instances.at(-1)!;
const newSignaller = () =>
  new WsSignaller({
    url: 'wss://signal.test/',
    WebSocketImpl: FakeWebSocket as unknown as typeof WebSocket,
    pingIntervalMs: 1000,
    pongTimeoutMs: 500,
  });

describe('WsSignaller', () => {
  beforeEach(() => {
    FakeWebSocket.instances.length = 0;
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('connects to the hashed room and emits peers and signals', async () => {
    const s = newSignaller();
    const joined = vi.fn();
    const signal = vi.fn();
    s.on('peer-joined', joined);
    s.on('signal', signal);
    const joining = s.join('secret-token', 'client');
    await vi.waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
    const url = new URL(last().url);
    expect(url.pathname).toBe(`/v1/rooms/${await roomIdFromToken('secret-token')}`);
    expect(url.searchParams.get('peer')).toBe(s.peerId);
    expect(url.searchParams.get('role')).toBe('client');
    expect(last().url).not.toContain('secret-token');

    last().welcome([{ id: 'a', role: 'server' }]);
    await joining;
    last().receive({ t: 'join', id: 'b', role: 'server' });
    last().receive({ t: 'signal', from: 'a', data: 'x' });
    expect(joined.mock.calls).toEqual([[{ peerId: 'a', role: 'server' }], [{ peerId: 'b', role: 'server' }]]);
    expect(signal).toHaveBeenCalledWith({ from: 'a', data: 'x' });

    await s.sendMessage('a', { sdp: 1 });
    expect(JSON.parse(last().sent.at(-1)!)).toEqual({ t: 'signal', to: 'a', data: { sdp: 1 } });
    await s.disconnect();
    expect(last().closedWith).toBe(1000);
  });

  it('reconnects, queues outgoing signals and diffs presence on welcome', async () => {
    const s = newSignaller();
    const joined = vi.fn();
    const left = vi.fn();
    s.on('peer-joined', joined);
    s.on('peer-left', left);
    const joining = s.join('t', 'client');
    await vi.waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
    last().welcome([
      { id: 'a', role: 'server' },
      { id: 'b', role: 'server' },
    ]);
    await joining;

    last().serverClose(1001); // e.g. a deploy
    await s.sendMessage('a', 'queued');
    await vi.advanceTimersByTimeAsync(600);
    expect(FakeWebSocket.instances).toHaveLength(2);
    expect(last().url).toBe(FakeWebSocket.instances[0]!.url);

    last().welcome([
      { id: 'a', role: 'server' },
      { id: 'c', role: 'server' },
    ]);
    expect(left).toHaveBeenCalledWith({ peerId: 'b' });
    expect(joined).toHaveBeenCalledTimes(3); // a, b, then c; a is not re-announced
    expect(JSON.parse(last().sent[0]!)).toEqual({ t: 'signal', to: 'a', data: 'queued' });
    await s.disconnect();
  });

  it('reconnects when a ping gets no pong', async () => {
    const s = newSignaller();
    const joining = s.join('t', 'server');
    await vi.waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
    last().welcome();
    await joining;
    await vi.advanceTimersByTimeAsync(1000);
    expect(last().sent).toEqual(['ping']);
    last().receive('pong');
    await vi.advanceTimersByTimeAsync(1000);
    expect(FakeWebSocket.instances).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(501); // second ping unanswered
    expect(FakeWebSocket.instances).toHaveLength(2);
    await s.disconnect();
  });

  it('gives up on fatal close codes and rejects join', async () => {
    const s = newSignaller();
    const joining = s.join('t', 'client');
    await vi.waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
    last().serverClose(CloseCode.RoomFull);
    await expect(joining).rejects.toThrow(/4003/);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it('resolves join when the server is unreachable and keeps retrying', async () => {
    const s = newSignaller();
    const joining = s.join('t', 'client');
    await vi.waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
    last().serverClose(1006);
    await joining;
    await vi.advanceTimersByTimeAsync(600);
    expect(FakeWebSocket.instances).toHaveLength(2);
    last().serverClose(1006);
    await vi.advanceTimersByTimeAsync(1100);
    expect(FakeWebSocket.instances).toHaveLength(3);
    await s.disconnect();
  });
});
