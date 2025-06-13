import { describe, expect, it } from 'vitest';
import createChunkedPort from './data-chunker';

/**
 * Lightweight twin-channel mock that does **not** rely on MessageChannel or RTCDataChannel.
 * Each peer is just an EventTarget with the minimal surface required by ChunkedMessagePort:
 *   • addEventListener / dispatchEvent (EventTarget)
 *   • send(data)            – emits a MessageEvent on the counterpart
 *   • bufferedAmount        – incremented by payload size, reset next micro‑task
 *   • bufferedAmountLowThreshold – configurable (0 by default)
 */
function createMockTransportPair() {
  class MockPeer extends EventTarget {
    public bufferedAmount = 0;
    public bufferedAmountLowThreshold = 0;
    public other: MockPeer | null = null;
    readonly readyState = 'open';

    send(data: any) {
      // simplistic back‑pressure simulation
      const inc = typeof data === 'string' ? data.length : (data.byteLength ?? 1);
      this.bufferedAmount += inc;
      queueMicrotask(() => {
        this.bufferedAmount = 0;
        this.dispatchEvent(new Event('bufferedamountlow'));
      });

      // Forward as MessageEvent to the remote side
      const evt = new MessageEvent('message', { data });
      this.other!.dispatchEvent(evt);
    }
  }

  const a = new MockPeer();
  const b = new MockPeer();
  // wire them together
  a.other = b;
  b.other = a;
  return [a, b] as const;
}

/** Returns two user‑facing MessagePorts that communicate through chunked transports */
function createPeers(chunkSize?: number) {
  const [rawA, rawB] = createMockTransportPair();
  const aPort = createChunkedPort(rawA as any, { chunkSize });
  const bPort = createChunkedPort(rawB as any, { chunkSize });
  return { a: aPort, b: bPort };
}

describe('ChunkedMessagePort', () => {
  it('round‑trips a small JSON object', async () => {
    const { a, b } = createPeers();

    const received = new Promise<any>(res => (b.onmessage = e => res(e.data)));
    a.postMessage({ hi: 'world' });

    expect(await received).toEqual({ hi: 'world' });
  });

  it('handles payloads larger than one chunk', async () => {
    const { a, b } = createPeers();

    const big = { blob: 'x'.repeat(100_000) };
    const got = new Promise<any>(res => (b.onmessage = e => res(e.data)));
    a.postMessage(big);

    expect(await got).toEqual(big);
  });

  it('honours custom chunkSize option', async () => {
    const custom = 256; // small to force many chunks
    const { a, b } = createPeers(custom);

    const payload = { data: 'y'.repeat(2000) };
    const done = new Promise<any>(res => (b.onmessage = e => res(e.data)));
    a.postMessage(payload);

    expect(await done).toEqual(payload);
  });

  it('preserves message order under rapid fire', async () => {
    const { a, b } = createPeers();

    const seen: string[] = [];
    b.onmessage = e => seen.push(e.data as string);
    ['first', 'second', 'third'].forEach(msg => a.postMessage(msg));

    await new Promise(res => setTimeout(res, 10));
    expect(seen).toEqual(['first', 'second', 'third']);
  });
});
