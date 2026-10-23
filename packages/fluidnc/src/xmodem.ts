import type { FluidncProtocol } from './protocol';

const SOH = 0x01;
const STX = 0x02;
const EOT = 0x04;
const ACK = 0x06;
const NAK = 0x15;
const CAN = 0x18;
const CRC_MODE = 0x43; // 'C'
const PAD = 0x1a;

export function crc16xmodem(data: Uint8Array): number {
  let crc = 0;
  for (const byte of data) {
    crc ^= byte << 8;
    for (let i = 0; i < 8; i++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc;
}

/** Build one XMODEM-1K (or 128 byte) block with CRC. */
export function xmodemBlock(blockNumber: number, chunk: Uint8Array, size: 128 | 1024): Uint8Array {
  const block = new Uint8Array(3 + size + 2);
  block[0] = size === 1024 ? STX : SOH;
  block[1] = blockNumber & 0xff;
  block[2] = 0xff - (blockNumber & 0xff);
  const data = block.subarray(3, 3 + size);
  data.fill(PAD);
  data.set(chunk);
  const crc = crc16xmodem(data);
  block[3 + size] = crc >> 8;
  block[4 + size] = crc & 0xff;
  return block;
}

/** A tiny byte queue with an awaitable `next()`. */
class ByteReader {
  private buffer: number[] = [];
  private waiter: (() => void) | null = null;
  push(bytes: Uint8Array) {
    this.buffer.push(...bytes);
    this.waiter?.();
  }
  async next(timeoutMs: number): Promise<number | null> {
    const deadline = Date.now() + timeoutMs;
    while (!this.buffer.length) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) return null;
      await new Promise<void>(resolve => {
        const timer = setTimeout(resolve, remaining);
        this.waiter = () => {
          clearTimeout(timer);
          resolve();
        };
      });
      this.waiter = null;
    }
    return this.buffer.shift()!;
  }
}

/**
 * Upload a file with `$Xmodem/Receive=<path>`. Slower than HTTP, but gives real progress and checksums.
 * `path` is a FluidNC path such as `/sd/camnc.gcode`.
 */
export async function xmodemUpload(
  protocol: FluidncProtocol,
  path: string,
  content: Uint8Array,
  onProgress?: (fraction: number) => void
): Promise<void> {
  await protocol.sendAndTakeStream(`$Xmodem/Receive=${path}`, async subscribe => {
    const reader = new ByteReader();
    subscribe(bytes => reader.push(bytes));

    // The receiver announces CRC mode by sending 'C' (after a 1 s delay).
    for (;;) {
      const byte = await reader.next(10_000);
      if (byte === null) throw new Error('XMODEM: receiver did not start');
      if (byte === CAN) throw new Error('XMODEM: receiver cancelled (cannot open file?)');
      if (byte === CRC_MODE) break;
    }

    const size = 1024;
    const blocks = Math.max(1, Math.ceil(content.length / size));
    for (let i = 0; i < blocks; i++) {
      const block = xmodemBlock(i + 1, content.subarray(i * size, (i + 1) * size), size);
      let retries = 0;
      for (;;) {
        protocol.sendRaw(block);
        const reply = await reader.next(10_000);
        if (reply === ACK) break;
        if (reply === CAN) throw new Error('XMODEM: receiver cancelled');
        if (reply === CRC_MODE) continue; // late 'C' from the start handshake
        if (reply !== NAK && reply !== null) continue;
        if (++retries > 10) throw new Error('XMODEM: too many retries');
      }
      onProgress?.((i + 1) / blocks);
    }
    for (let retries = 0; ; retries++) {
      protocol.sendRaw(new Uint8Array([EOT]));
      const reply = await reader.next(5_000);
      if (reply === ACK) break;
      if (retries > 5) throw new Error('XMODEM: no ACK for EOT');
    }
  });
}
