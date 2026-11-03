import { describe, expect, it } from 'vitest';
import { colorDistance, hue, kOpPalette, kStockColor, kViewBackground, oklab, opColor } from './palette';

const lightness = (hex: string) => oklab(hex)[0];

describe('op palette', () => {
  it('has no violet: the UI accent (OKLCh hue ~293) stays reserved for the UI', () => {
    for (const c of kOpPalette) {
      const h = hue(c);
      expect(h < 255 || h > 335, `${c} hue ${h.toFixed(0)}`).toBe(true);
    }
  });

  it('keeps every pair of op colors clearly apart', () => {
    for (let i = 0; i < kOpPalette.length; i++)
      for (let j = i + 1; j < kOpPalette.length; j++)
        expect(colorDistance(kOpPalette[i], kOpPalette[j]), `${kOpPalette[i]} vs ${kOpPalette[j]}`).toBeGreaterThan(0.12);
  });

  it('alternates dark and light, so neighbouring ops differ by lightness too (also where it wraps around)', () => {
    for (let i = 0; i < kOpPalette.length * 2; i++) {
      expect(Math.abs(lightness(opColor(i)) - lightness(opColor(i + 1)))).toBeGreaterThan(0.2);
    }
  });

  it('stands out against the stock and the background', () => {
    for (const c of kOpPalette) {
      expect(colorDistance(c, kStockColor), `${c} vs stock`).toBeGreaterThan(0.12);
      expect(lightness(c) - lightness(kViewBackground), `${c} vs background`).toBeGreaterThan(0.2);
    }
  });

  it('cycles for more groups than colors', () => {
    expect(opColor(kOpPalette.length)).toBe(kOpPalette[0]);
    expect(opColor(3)).toBe(kOpPalette[3]);
  });
});
