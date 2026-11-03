import { describe, expect, it } from 'vitest';
import { parseFusionToolLibrary, readFusionToolLibrary } from './tools';

// Same shape as Fusion's Local/Library.json, trimmed to the fields that matter.
const library = {
  version: 22,
  data: [
    {
      type: 'flat end mill',
      guid: 'g-1',
      unit: 'millimeters',
      description: '1/8 mill v1',
      geometry: { DC: 3.175, NOF: 1 },
      'post-process': { number: 1 },
      'start-values': {
        presets: [{ v_f: 1800, v_f_plunge: 480, n: 15000, stepover: 1.27, 'use-stepover': true, stepdown: 9, 'use-stepdown': false }],
      },
    },
    { type: 'chamfer mill', unit: 'millimeters', description: 'engraver', geometry: { DC: 3.175 }, 'post-process': { number: 2 } },
    { type: 'holder', description: 'makita' },
    {
      type: 'flat end mill',
      unit: 'inches',
      description: '1/4 inch',
      geometry: { DC: 0.25, NOF: 2 },
      'post-process': { number: 7 },
      'start-values': { presets: [{ v_f: 100, v_f_plunge: 20, n: 18000 }] },
    },
  ],
};

describe('Fusion tool library', () => {
  it('reads flat end mills with their feeds, in mm', () => {
    expect(parseFusionToolLibrary(JSON.stringify(library))).toEqual([
      // Stepover applies ("use-stepover"), the preset's stepdown doesn't.
      { number: 1, diameter: 3.175, name: '1/8 mill v1', guid: 'g-1', flutes: 1, feed: 1800, plungeFeed: 480, rpm: 15000, stepover: 1.27 },
      { number: 7, diameter: 6.35, name: '1/4 inch', flutes: 2, feed: 2540, plungeFeed: 508, rpm: 18000 },
    ]);
  });

  it('says what it skipped', () => {
    expect(readFusionToolLibrary(library).skipped).toEqual({ 'chamfer mill': 1 });
  });

  it('rejects other JSON', () => {
    expect(() => parseFusionToolLibrary('{"tools": []}')).toThrow(/Fusion tool library/);
  });
});
