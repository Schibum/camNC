import { describe, expect, it } from 'vitest';
import { fittedScale } from './fittedScale';

describe('fittedScale', () => {
  const area = { w: 1400, h: 1400 };

  it('fills the area with a small board on its own', () => {
    const scale = fittedScale('board', area, { w: 105, h: 165 });
    expect(scale * 165).toBeGreaterThan(0.85 * area.h);
    expect(scale * 165).toBeLessThan(area.h - 96);
  });

  it('keeps a wide board within the width', () => {
    expect(fittedScale('board', area, { w: 2500, h: 100 }) * 2500).toBeLessThan(area.w - 34);
  });

  it('keeps small boards life size next to each other', () => {
    expect(fittedScale('all', area, { w: 105, h: 165 })).toBe(1.5);
  });
});
