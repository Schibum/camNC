import { describe, expect, it } from 'vitest';
import { crc16xmodem, xmodemBlock } from './xmodem';

describe('xmodem', () => {
  it('computes CRC-16/XMODEM', () => {
    expect(crc16xmodem(new TextEncoder().encode('123456789'))).toBe(0x31c3);
  });

  it('pads blocks and adds the inverted block number', () => {
    const block = xmodemBlock(1, new Uint8Array([0x41]), 128);
    expect(block.length).toBe(133);
    expect([...block.slice(0, 5)]).toEqual([0x01, 1, 254, 0x41, 0x1a]);
  });
});
