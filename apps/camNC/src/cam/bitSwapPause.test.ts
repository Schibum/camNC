import { pauseHint } from '@/lib/machine/pauseHints';
import { camBoard, toGcode, type PartFeatures } from '@wbcnc/cam';
import { describe, expect, it } from 'vitest';

const rect = (x0: number, y0: number, x1: number, y1: number) => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];

/** 120 x 80 x 8 board with a 3.1 mm slot only a 3 mm bit fits, and a pocket for the 6 mm bit. */
function features(): PartFeatures {
  const outline = rect(0, 0, 120, 80);
  const slot = rect(20, 20, 100, 23.1);
  const pocket = rect(20, 40, 100, 60);
  return {
    thickness: 8,
    footprint: [outline],
    outlines: [outline],
    throughHoles: [],
    levels: [],
    pockets: [
      { floorZ: 4, region: [pocket], strictRegion: [pocket], above: [], area: 1600 },
      { floorZ: 2, region: [slot], strictRegion: [slot], above: [], area: 248 },
    ],
    bottomFaces: [],
    slopedArea: 0,
  };
}

describe('board program bit swap at the machine', () => {
  it('pauses once between bits with a message the job view explains', () => {
    const cam = camBoard(
      {
        id: 'a',
        name: 'A',
        w: 160,
        h: 120,
        thickness: 8,
        holdDown: 'fixture-tape',
        parts: [{ id: 'p', name: 'p', features: features(), size: [120, 80, 8], x: 20, y: 20, rotated: false }],
      },
      {
        tools: [
          { number: 1, diameter: 6, name: 'flat end mill' },
          { number: 2, diameter: 3, name: 'flat end mill' },
        ],
      }
    );
    const gcode = toGcode(cam);
    const swaps = gcode.split('\n').filter(l => /^M0 \(MSG Spindle OFF/.test(l));
    expect(swaps).toHaveLength(1);
    // Where FluidNC reports the pause: just after the M0 line.
    const at = gcode.indexOf(swaps[0]) + swaps[0].length + 1;
    const hint = pauseHint(gcode, (100 * new TextEncoder().encode(gcode.slice(0, at)).length) / new TextEncoder().encode(gcode).length);
    expect(hint?.reason).toContain('Change to T1 D=6, re-zero Z');
    expect(hint?.next).toBe('Resume continues with the next move.');
  });
});
