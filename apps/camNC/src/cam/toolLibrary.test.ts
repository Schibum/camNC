import { describe, expect, it } from 'vitest';
import { mergeLibrary, readLibraryFile, useToolLibrary, type StoredBit } from './toolLibrary';

const library = JSON.stringify({
  data: [
    {
      type: 'flat end mill',
      unit: 'millimeters',
      description: '1/8 mill v1',
      geometry: { DC: 3.175, NOF: 1 },
      'post-process': { number: 1 },
      'start-values': { presets: [{ v_f: 1800, v_f_plunge: 480, n: 15000 }] },
    },
    { type: 'ball end mill', unit: 'millimeters', description: '6mm radius', geometry: { DC: 6 }, 'post-process': { number: 3 } },
    { type: 'chamfer mill', unit: 'millimeters', description: 'engraver', geometry: { DC: 3.175 }, 'post-process': { number: 2 } },
  ],
});

/** A one-file zip (deflated), like Fusion's .tools export. CRCs aren't checked by the reader. */
async function zip(name: string, text: string): Promise<Uint8Array> {
  const data = new TextEncoder().encode(text);
  const deflated = new Uint8Array(
    await new Response(new Blob([data]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer()
  );
  const nameBytes = new TextEncoder().encode(name);
  const local = new DataView(new ArrayBuffer(30));
  local.setUint32(0, 0x04034b50, true);
  local.setUint16(8, 8, true);
  local.setUint32(18, deflated.length, true);
  local.setUint32(22, data.length, true);
  local.setUint16(26, nameBytes.length, true);
  const central = new DataView(new ArrayBuffer(46));
  central.setUint32(0, 0x02014b50, true);
  central.setUint16(10, 8, true);
  central.setUint32(20, deflated.length, true);
  central.setUint32(24, data.length, true);
  central.setUint16(28, nameBytes.length, true);
  central.setUint32(42, 0, true);
  const cdStart = 30 + nameBytes.length + deflated.length;
  const eocd = new DataView(new ArrayBuffer(22));
  eocd.setUint32(0, 0x06054b50, true);
  eocd.setUint16(8, 1, true);
  eocd.setUint16(10, 1, true);
  eocd.setUint32(12, 46 + nameBytes.length, true);
  eocd.setUint32(16, cdStart, true);
  const parts = [new Uint8Array(local.buffer), nameBytes, deflated, new Uint8Array(central.buffer), nameBytes, new Uint8Array(eocd.buffer)];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

describe('Fusion tool library import', () => {
  it('reads Library.json: flat end mills, and what was skipped', async () => {
    const r = await readLibraryFile(new File([library], 'Library.json'));
    expect(r).toEqual({
      ok: true,
      file: 'Library.json',
      tools: [{ number: 1, diameter: 3.175, name: '1/8 mill v1', flutes: 1, feed: 1800, plungeFeed: 480, rpm: 15000 }],
      skipped: { 'ball end mill': 1, 'chamfer mill': 1 },
    });
  });

  it('reads a zipped .tools export', async () => {
    const r = await readLibraryFile(new File([await zip('tools.json', library)], 'My bits.tools'));
    expect(r.ok && r.tools.map(t => t.name)).toEqual(['1/8 mill v1']);
  });

  it('says what is wrong with other files', async () => {
    const r = await readLibraryFile(new File(['{"x":1}'], 'other.json'));
    expect(r).toEqual({ ok: false, error: 'other.json: Not a Fusion tool library (expected { "data": [...] })' });
  });
});

describe('stored bits', () => {
  const lib = [
    { number: 1, diameter: 3.175, name: '1/8 mill v1', guid: 'a', feed: 1800 },
    { number: 2, diameter: 6, name: '6 mm', guid: 'b' },
  ];

  it('merges a re-import by Fusion guid: updates changed bits, adds new ones, leaves custom bits alone', () => {
    const custom: StoredBit = { id: 'c', source: 'custom', number: 9, diameter: 2, name: '2 mm' };
    const first = mergeLibrary([custom], lib, 'Library.json');
    expect([first.added, first.updated]).toEqual([2, 0]);
    // Fusion renamed the 1/8" bit and changed its feed; a third bit is new.
    const again = mergeLibrary(
      first.bits,
      [{ ...lib[0], name: '1/8 mill v2', feed: 2400 }, lib[1], { number: 3, diameter: 1.5, name: '1.5 mm', guid: 'c' }],
      'Library.json'
    );
    expect([again.added, again.updated]).toEqual([1, 1]);
    expect(again.bits.map(b => [b.source, b.name])).toEqual([
      ['custom', '2 mm'],
      ['library', '1/8 mill v2'],
      ['library', '6 mm'],
      ['library', '1.5 mm'],
    ]);
    expect(again.bits.find(b => b.guid === 'a')!.feed).toBe(2400);
  });

  it('adds custom bits with the next free tool number, edits and removes them', () => {
    useToolLibrary.setState({ bits: [], imports: [] });
    const { importLibrary, addCustom, updateBit, removeBit } = useToolLibrary.getState();
    expect(importLibrary(lib, 'Library.json')).toEqual({ added: 2, updated: 0 });
    addCustom({ diameter: 4, name: '4 mm 2-flute', flutes: 2 });
    const custom = useToolLibrary.getState().bits.at(-1)!;
    expect([custom.source, custom.number]).toEqual(['custom', 3]);
    updateBit(custom.id, { name: '4 mm upcut' });
    expect(useToolLibrary.getState().bits.at(-1)!.name).toBe('4 mm upcut');
    removeBit(custom.id);
    expect(useToolLibrary.getState().bits).toHaveLength(2);
    expect(useToolLibrary.getState().imports.map(i => [i.file, i.added])).toEqual([['Library.json', 2]]);
  });
});
