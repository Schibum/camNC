/**
 * The drawing's scale before zoom, px per mm. One board fills the area whatever its size, with room left to drag it bigger.
 * All boards: one scale, the widest fits the column, the tallest takes at most half its height, so several boards are in view
 * to drag between; small ones don't get bigger than life there.
 */
export function fittedScale(view: 'board' | 'all', area: { w: number; h: number }, size: { w: number; h: number }) {
  const byWidth = (area.w - 34) / size.w;
  return view === 'board'
    ? 0.92 * Math.max(0.15, Math.min(byWidth, (area.h - 96) / size.h))
    : Math.min(1.5, Math.max(0.15, Math.min(byWidth, (area.h * 0.5 - 40) / size.h)));
}
