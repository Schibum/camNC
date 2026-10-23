import { SELF } from 'cloudflare:test';
import { CloseCode, MAX_PEERS_PER_ROOM, roomIdFromToken, type ServerMessage } from '@wbcnc/webrtc-channel/signal-protocol';
import { describe, expect, it } from 'vitest';

interface TestClient {
  ws: WebSocket;
  messages: ServerMessage[];
  closed: Promise<CloseEvent>;
  next: (t?: ServerMessage['t']) => Promise<ServerMessage>;
  send: (msg: unknown) => void;
}

async function connect(roomId: string, peer: string, role: string, origin = 'https://run.camnc.app'): Promise<TestClient> {
  const res = await SELF.fetch(`https://signal.test/v1/rooms/${roomId}?peer=${peer}&role=${role}`, {
    headers: { Upgrade: 'websocket', Origin: origin },
  });
  expect(res.status).toBe(101);
  const ws = res.webSocket!;
  const messages: ServerMessage[] = [];
  const waiters: (() => void)[] = [];
  ws.addEventListener('message', ev => {
    if (typeof ev.data === 'string' && ev.data !== 'pong') messages.push(JSON.parse(ev.data));
    waiters.splice(0).forEach(w => w());
  });
  const closed = new Promise<CloseEvent>(resolve => ws.addEventListener('close', resolve));
  ws.accept();
  let read = 0;
  const next = async (t?: ServerMessage['t']): Promise<ServerMessage> => {
    for (;;) {
      while (read < messages.length) {
        const msg = messages[read++]!;
        if (!t || msg.t === t) return msg;
      }
      await new Promise<void>(resolve => waiters.push(resolve));
    }
  };
  return { ws, messages, closed, next, send: msg => ws.send(JSON.stringify(msg)) };
}

const newRoom = () => roomIdFromToken(crypto.randomUUID());
const peerId = () => crypto.randomUUID();

describe('signal worker', () => {
  it('rejects plain HTTP requests and bad origins', async () => {
    const room = await newRoom();
    expect((await SELF.fetch(`https://signal.test/v1/rooms/${room}`)).status).toBe(426);
    const res = await SELF.fetch(`https://signal.test/v1/rooms/${room}?peer=${peerId()}&role=server`, {
      headers: { Upgrade: 'websocket', Origin: 'https://evil.example' },
    });
    expect(res.status).toBe(403);
  });

  it('accepts wildcard origins', async () => {
    const a = await connect(await newRoom(), peerId(), 'server', 'https://pr-12-camnc.someone.workers.dev');
    expect((await a.next()).t).toBe('welcome');
  });

  it('closes with BadRequest on an invalid room id', async () => {
    const res = await SELF.fetch(`https://signal.test/v1/rooms/not-a-room?peer=${peerId()}&role=server`, {
      headers: { Upgrade: 'websocket' },
    });
    const ws = res.webSocket!;
    const closed = new Promise<CloseEvent>(resolve => ws.addEventListener('close', resolve));
    ws.accept();
    expect((await closed).code).toBe(CloseCode.BadRequest);
  });

  it('announces peers and relays signals with a server-stamped sender', async () => {
    const room = await newRoom();
    const [idA, idB] = [peerId(), peerId()];
    const a = await connect(room, idA, 'server');
    expect(await a.next()).toEqual({ t: 'welcome', self: idA, peers: [] });

    const b = await connect(room, idB, 'client');
    expect(await b.next()).toEqual({ t: 'welcome', self: idB, peers: [{ id: idA, role: 'server' }] });
    expect(await a.next()).toEqual({ t: 'join', id: idB, role: 'client' });

    a.send({ t: 'signal', to: idB, data: { description: 'offer' }, from: 'spoofed' });
    expect(await b.next()).toEqual({ t: 'signal', from: idA, data: { description: 'offer' } });

    a.send({ t: 'signal', to: peerId(), data: 1 });
    expect(await a.next('error')).toMatchObject({ code: 'unknown-peer' });

    b.ws.close(1000);
    expect(await a.next()).toEqual({ t: 'leave', id: idB });
  });

  it('replaces a socket that reconnects with the same peer id without leave/join', async () => {
    const room = await newRoom();
    const [idA, idB] = [peerId(), peerId()];
    const a = await connect(room, idA, 'server');
    await a.next();
    const b1 = await connect(room, idB, 'client');
    await b1.next();
    expect(await a.next()).toMatchObject({ t: 'join', id: idB });

    const b2 = await connect(room, idB, 'client');
    expect(await b2.next()).toEqual({ t: 'welcome', self: idB, peers: [{ id: idA, role: 'server' }] });
    expect((await b1.closed).code).toBe(CloseCode.Replaced);

    a.send({ t: 'signal', to: idB, data: 'still there' });
    expect(await b2.next()).toMatchObject({ t: 'signal', data: 'still there' });
    // Neither a leave nor a second join reached A.
    expect(a.messages.filter(m => m.t === 'leave' || m.t === 'join')).toHaveLength(1);
  });

  it('answers keep-alive pings', async () => {
    const a = await connect(await newRoom(), peerId(), 'server');
    await a.next();
    const pong = new Promise<string>(resolve =>
      a.ws.addEventListener('message', ev => {
        if (ev.data === 'pong') resolve(ev.data);
      })
    );
    a.ws.send('ping');
    expect(await pong).toBe('pong');
  });

  it('rejects malformed messages', async () => {
    const a = await connect(await newRoom(), peerId(), 'server');
    await a.next();
    a.ws.send('not json');
    expect(await a.next('error')).toMatchObject({ code: 'bad-message' });
  });

  it('closes with RoomFull once the room has the maximum number of peers', async () => {
    const room = await newRoom();
    for (let i = 0; i < MAX_PEERS_PER_ROOM; i++) await connect(room, peerId(), 'client');
    const res = await SELF.fetch(`https://signal.test/v1/rooms/${room}?peer=${peerId()}&role=client`, {
      headers: { Upgrade: 'websocket' },
    });
    const ws = res.webSocket!;
    const closed = new Promise<CloseEvent>(resolve => ws.addEventListener('close', resolve));
    ws.accept();
    expect((await closed).code).toBe(CloseCode.RoomFull);
  });
});
