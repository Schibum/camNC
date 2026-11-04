/**
 * Operation colors for the 3D Plan view, the same in the simulation, the toolpath layers, the timeline and the op
 * list. No violet: that is the UI accent. Dark and light colors alternate, so neighbouring ops differ in lightness
 * too, and none is close to the wood of the stock.
 */
export const kOpPalette = ['#0369a1', '#facc15', '#15803d', '#22d3ee', '#dc2626', '#a3e635', '#9f1239', '#fda4af'] as const;

/** The simulated stock (wood). */
export const kStockColor = '#c9a46e';

/** The 3D view's background. */
export const kViewBackground = '#18181b';

/** Color of the n-th operation group. */
export const opColor = (n: number) => kOpPalette[((n % kOpPalette.length) + kOpPalette.length) % kOpPalette.length];

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

/** OKLab [L, a, b] of a #rrggbb color: perceptually even, so distances compare across hues. */
export function oklab(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  const r = toLinear((n >> 16) / 255);
  const g = toLinear(((n >> 8) & 255) / 255);
  const b = toLinear((n & 255) / 255);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

/** Perceptual distance of two colors (OKLab ΔE; about 0.02 is barely visible, 0.1 clearly different). */
export function colorDistance(a: string, b: string) {
  const [x, y] = [oklab(a), oklab(b)];
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
}

/** OKLCh hue in degrees (0..360). */
export function hue(hex: string) {
  const [, a, b] = oklab(hex);
  return ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360;
}
