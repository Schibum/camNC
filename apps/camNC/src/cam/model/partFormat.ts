import type { CamPartInfo } from '../camTypes';

export const fmt = (v: number) => `${+v.toFixed(1)}`;

/** Milled parts grouped by board thickness (thickest first), then the parts left out. */
export function groupParts(parts: CamPartInfo[], milled: (id: string) => boolean) {
  const byT = new Map<number, CamPartInfo[]>();
  for (const p of parts.filter(p => milled(p.id))) {
    const t = +p.thickness.toFixed(1);
    byT.set(t, [...(byT.get(t) ?? []), p]);
  }
  const groups = [...byT.entries()].sort((a, b) => b[0] - a[0]);
  return { groups, notMilled: parts.filter(p => !milled(p.id)) };
}
