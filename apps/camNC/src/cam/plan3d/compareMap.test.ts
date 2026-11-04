import { Box2, Vector2 } from 'three';
import { describe, expect, it } from 'vitest';
import type { BoardRequest, CamPartInfo } from '../camTypes';
import { compareClass, designTexture } from './compareMap';

describe('compare to the model', () => {
  it('as designed within the tolerance, material left above it, cut too deep below it; holes just need cutting through', () => {
    expect(compareClass(8.3, 8.3, 8.3, true, false)).toBe('ok');
    expect(compareClass(8.25, 8.3, 8.3, true, false)).toBe('ok');
    expect(compareClass(4.5, 4.1, 4.1, true, false)).toBe('left');
    expect(compareClass(3.9, 4.1, 4.1, true, false)).toBe('over');
    // At a wall the model's height around the spot spans both levels: either is right.
    expect(compareClass(4.1, 4.1, 8.3, true, false)).toBe('ok');
    expect(compareClass(-0.3, 0, 0, true, true)).toBe('ok');
    expect(compareClass(2, 0, 0, true, true)).toBe('left');
    expect(compareClass(-5, 8, 8, false, false)).toBe('none');
  });

  it('draws the model: parts at the stock top, pockets at their floor, holes cut through, waste not judged', () => {
    const square = (x0: number, y0: number, x1: number, y1: number): [number, number][] => [
      [x0, y0],
      [x1, y0],
      [x1, y1],
      [x0, y1],
    ];
    const part = {
      id: 'p',
      size: [100, 50, 8],
      thickness: 8,
      shape: {
        outlines: [square(0, 0, 100, 50)],
        holes: [square(80, 20, 90, 30)],
        pockets: [{ depth: 4, region: [square(10, 10, 40, 40)] }],
      },
    } as unknown as CamPartInfo;
    const board = { parts: [{ id: 'p#0', partId: 'p', name: 'p', x: 10, y: 10, rotated: false }] } as unknown as BoardRequest;
    const domain = { footprint: new Box2(new Vector2(0, 0), new Vector2(200, 100)), width: 200, height: 100, zLow: -2, zTop: 8 };
    const canvas = designTexture(board, [part], domain).image as HTMLCanvasElement;
    const at = (x: number, y: number) => [
      ...canvas
        .getContext('2d')!
        .getImageData(x, 100 - y - 1, 1, 1)
        .data.slice(0, 3),
    ];
    const level = (z: number) => Math.round((255 * (z - -2)) / 10);
    expect(at(60, 50)).toEqual([level(8), 255, 0]); // part top
    expect(at(30, 30)).toEqual([level(4), 255, 0]); // pocket floor
    expect(at(95, 35)).toEqual([0, 255, 255]); // hole
    expect(at(150, 80)).toEqual([0, 0, 0]); // waste
  });
});
