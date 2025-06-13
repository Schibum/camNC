/**
 * ChunkedMessagePort – the thinnest possible helper that lifts the RTCDataChannel
 * message‑size limit by transparently chunking large **JSON‑serialisable** payloads.
 *
 * API surface for consumers is **just a MessagePort** – you postMessage() and add
 * `message` listeners exactly like with a normal `MessagePort`, but under the hood
 * the helper splits and reassembles large messages before bridging them through
 * the provided RTCDataChannel (or any EventTarget that behaves like one).
 *
 * Usage:
 * ```ts
 * import createChunkedPort from './ChunkedMessagePort'
 *
 * const port = createChunkedPort(dataChannel)
 * port.onmessage = (e) => console.log('peer says:', e.data)
 * port.postMessage({ huge: new Array(100_000).fill('x').join('') })
 * ```
 */

// -- Minimal local utils --------------------------------------------------
const te = new TextEncoder();
const td = new TextDecoder();
const encode = (s: string) => te.encode(s);
const decode = (u8: Uint8Array) => td.decode(u8);

// Header layout:  [id (1 byte)] [tag (1 byte)] [payload…]
// tag bit‑masks
const LAST = 1 << 0;
const JSON_FLAG = 1 << 1; // always 1 for now, but kept for future binary upgrade

const HEADER = 2; // id + tag
const CHUNK_SIZE = 16 * 1024 - HEADER; // 16 KiB minus header

// ----------------------------------------------------------------------------
export default function createChunkedPort(
  channel: Pick<
    RTCDataChannel,
    "send" | "addEventListener" | "removeEventListener" | "readyState"
  > & {
    bufferedAmount?: number;
    bufferedAmountLowThreshold?: number;
  },
  opts: { chunkSize?: number } = {},
): MessagePort {
  const chunkSize = Math.max(256, opts.chunkSize ?? CHUNK_SIZE);
  let nonce = 0; // uint8 rollover is fine for one tab‑lifetime

  // pending chunks keyed by id
  const pendings: Record<number, Uint8Array[]> = {};

  // Expose one end of an internal MessageChannel to the caller
  const { port1: appPort, port2: workerPort } = new MessageChannel();

  // -- Outgoing -----------------------------------------------------------
  workerPort.addEventListener("message", async (e) => {
    // console.log("xxmessage", e.data);
    const id = (nonce = (nonce + 1) & 0xff);
    const json = JSON.stringify(e.data);
    const bytes = encode(json);
    const total = Math.ceil(bytes.byteLength / chunkSize) || 1;

    for (let i = 0; i < total; i++) {
      const isLast = i === total - 1;
      const slice = bytes.subarray(i * chunkSize, (i + 1) * chunkSize);
      const packet = new Uint8Array(HEADER + slice.byteLength);
      packet[0] = id;
      packet[1] = (isLast ? LAST : 0) | JSON_FLAG;
      packet.set(slice, HEADER);

      // simple back‑pressure – wait for lowThreshold drain if configured
      if (
        typeof channel.bufferedAmount === "number" &&
        typeof channel.bufferedAmountLowThreshold === "number" &&
        channel.bufferedAmount > channel.bufferedAmountLowThreshold
      ) {
        await new Promise<void>((res) => {
          const h = () => {
            channel.removeEventListener("bufferedamountlow", h as any);
            res();
          };
          channel.addEventListener("bufferedamountlow", h as any);
        });
      }

      if (channel.readyState !== "open") {
        // Just ignore, Comlink does send a release event when the channel is already closed
        return;
      }
      channel.send(packet);
    }
  });
  workerPort.start();
  appPort.start();

  // -- Incoming -----------------------------------------------------------
  channel.addEventListener("message", (evt: MessageEvent<ArrayBuffer>) => {
    // console.log("message", evt.data);
    const data = new Uint8Array(evt.data);
    const id = data[0];
    const tag = data[1];
    if (!id || !tag) return;
    const chunk = data.subarray(HEADER);

    (pendings[id] ||= []).push(chunk);

    if (!(tag & LAST)) return; // not complete yet

    const fullLen = pendings[id].reduce((n, c) => n + c.byteLength, 0);
    const full = new Uint8Array(fullLen);
    pendings[id].reduce((off, c) => {
      full.set(c, off);
      return off + c.byteLength;
    }, 0);

    delete pendings[id];

    if (tag & JSON_FLAG) {
      const obj = JSON.parse(decode(full));
      workerPort.postMessage(obj);
    }
  });

  return appPort;
}
