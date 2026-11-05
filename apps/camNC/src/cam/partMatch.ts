import type { BoardV1 } from './boards';
import type { CamPartInfo, Outline2D } from './camTypes';
import type { CamJobPartV1 } from './jobDb';

/** What identifies a part across versions of a model, however it lies or wherever it is in the file. */
export interface PartPrint {
  /** The name in the model file. */
  modelName: string;
  /** Bounding box, sides sorted. */
  size: [number, number, number];
  /** Top view area without the holes, mm². */
  area: number;
  /** That area × thickness less the pockets, mm³. */
  volume: number;
}

/** Sides may differ this much, mm, and area and volume this share: a STEP export rounds. */
const kSizeTolerance = 0.1;
const kShareTolerance = 0.01;

const pathsArea = (paths: Outline2D) =>
  paths.reduce(
    (sum, p) => sum + Math.abs(p.reduce((a, [x, y], i) => a + x * p[(i + 1) % p.length][1] - p[(i + 1) % p.length][0] * y, 0)) / 2,
    0
  );

export function partPrint(part: Pick<CamPartInfo, 'name' | 'modelName' | 'size' | 'thickness' | 'shape'>): PartPrint {
  const area = pathsArea(part.shape.outlines) - pathsArea(part.shape.holes);
  const pockets = part.shape.pockets.reduce((sum, p) => sum + pathsArea(p.region) * p.depth, 0);
  return {
    modelName: part.modelName ?? part.name,
    size: [...part.size].sort((a, b) => a - b) as [number, number, number],
    area: +area.toFixed(1),
    volume: +(area * part.thickness - pockets).toFixed(0),
  };
}

const closeShare = (a: number, b: number) => Math.abs(a - b) <= kShareTolerance * Math.max(Math.abs(a), Math.abs(b));

export const samePrint = (a: PartPrint, b: PartPrint) =>
  a.size.every((s, i) => Math.abs(s - b.size[i]) <= kSizeTolerance) && closeShare(a.area, b.area) && closeShare(a.volume, b.volume);

export interface PartMatch {
  /** New part id -> old part id, for parts that are surely the same. */
  matched: Map<string, string>;
  /** Parts that keep nothing, for one warning: new ones, and old ones that are gone. */
  affected: { name: string; why: 'changed' | 'unclear' | 'new' | 'gone' }[];
}

/**
 * Which part of a replaced model is which, by what it is, not by where it is in the file: by the body's name with the
 * same shape, then, for a renamed body, by shape alone. Only a single candidate on both sides counts.
 */
export function matchReplacedParts(
  before: { id: string; name: string; print: PartPrint }[],
  after: { id: string; print: PartPrint }[]
): PartMatch {
  const matched = new Map<string, string>();
  const pair = (same: (a: PartPrint, b: PartPrint) => boolean) => {
    const used = new Set(matched.values());
    const olds = before.filter(o => !used.has(o.id));
    const news = after.filter(n => !matched.has(n.id));
    for (const n of news) {
      const candidates = olds.filter(o => same(o.print, n.print));
      if (candidates.length === 1 && news.filter(other => same(candidates[0].print, other.print)).length === 1)
        matched.set(n.id, candidates[0].id);
    }
  };
  pair((a, b) => a.modelName === b.modelName && samePrint(a, b));
  pair(samePrint);
  const used = new Set(matched.values());
  const left = before.filter(o => !used.has(o.id));
  const affected: PartMatch['affected'] = after
    .filter(n => !matched.has(n.id))
    .map(n => ({
      name: n.print.modelName,
      why: left.some(o => samePrint(o.print, n.print))
        ? 'unclear'
        : left.some(o => o.print.modelName === n.print.modelName)
          ? 'changed'
          : 'new',
    }));
  const named = new Set(after.filter(n => !matched.has(n.id)).map(n => n.print.modelName));
  const shaped = (o: (typeof left)[number]) => after.some(n => !matched.has(n.id) && samePrint(o.print, n.print));
  for (const o of left) if (!named.has(o.print.modelName) && !shaped(o)) affected.push({ name: o.name, why: 'gone' });
  return { matched, affected };
}

/**
 * The job's part list for a model: names and milled ticks stay with the part, by id or, after a replaced model
 * (`replaced`), with the part found again. A part not found again starts as any part of a new model does.
 */
export function carriedParts(
  parts: Pick<CamPartInfo, 'id' | 'name' | 'names' | 'summary'>[],
  jobParts: CamJobPartV1[],
  replaced: { matched: PartMatch['matched']; prints: Record<string, PartPrint> } | null
): CamJobPartV1[] {
  const known = new Map(jobParts.map(p => [p.id, p]));
  return parts.map(p => {
    const old = known.get(replaced ? (replaced.matched.get(p.id) ?? '') : p.id);
    // After a replaced model a name the user didn't give follows the model; theirs stays.
    const given = old && (!replaced || old.name !== replaced.prints[old.id]?.modelName);
    return { id: p.id, name: given ? old.name : p.name, quantity: p.names.length, milled: old?.milled ?? !p.summary.notFlat };
  });
}

const kWhy: Record<PartMatch['affected'][number]['why'], string> = {
  changed: 'changed',
  unclear: 'can’t tell which',
  new: 'new',
  gone: 'gone',
};

/** The one warning after a replaced model, or nothing when every part was found again. */
export function replaceWarning(affected: PartMatch['affected']) {
  if (!affected.length) return undefined;
  const list = affected.map(a => `${a.name} (${kWhy[a.why]})`).join(', ');
  return `Model replaced: these parts did not keep a name or milled tick, check them: ${list}.`;
}

/** Boards after a replaced model: bodies follow their part to its new id, those of parts not found again are off. */
export function remapBoards(boards: BoardV1[], matched: PartMatch['matched']): BoardV1[] {
  const newId = new Map([...matched].map(([next, old]) => [old, next]));
  const instance = (id: string) => {
    const [part, k] = id.split('#');
    const next = newId.get(part);
    return next && `${next}#${k}`;
  };
  const ids = (list: string[]) => list.flatMap(id => instance(id) ?? []);
  const keys = <T>(record: Record<string, T>) =>
    Object.fromEntries(Object.entries(record).flatMap(([id, v]) => (instance(id) ? [[instance(id)!, v] as const] : [])));
  return boards.map(b => ({
    ...b,
    items: ids(b.items),
    ...(b.pinned && { pinned: ids(b.pinned) }),
    ...(b.layout && { layout: { ...b.layout, at: keys(b.layout.at) } }),
    ...(b.tabsAt && { tabsAt: keys(b.tabsAt) }),
  }));
}
