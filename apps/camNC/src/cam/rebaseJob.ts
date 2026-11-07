import type { CamJobV1 } from './jobDb';
import { physicalSheetIdOf } from './boards';

const same = (a: unknown, b: unknown) => a === b || JSON.stringify(a) === JSON.stringify(b);

/** `current` with what changed from `base` to `next`, key by key. */
function rebaseFields<T extends object>(base: T, next: T, current: T): T {
  const out = { ...current } as Record<string, unknown>;
  const [b, n] = [base as Record<string, unknown>, next as Record<string, unknown>];
  for (const key of new Set([...Object.keys(b), ...Object.keys(n)])) {
    if (same(b[key], n[key])) continue;
    if (key in n) out[key] = n[key];
    else delete out[key];
  }
  return out as T;
}

type Boards = NonNullable<CamJobV1['boards']>;

function rebaseBoards(base: Boards, next: Boards, current: Boards): Boards {
  const inBase = new Map(base.map(b => [b.id, b]));
  const inNext = new Map(next.map(b => [b.id, b]));
  const kept = current.flatMap(b => {
    const [was, now] = [inBase.get(b.id), inNext.get(b.id)];
    if (was && physicalSheetIdOf(was) !== physicalSheetIdOf(b)) return [b];
    if (was && !now) return [];
    if (!was || !now) return [b];
    const merged = rebaseFields(was, now, b);
    if (now.cut?.sourceKey && b.cut?.sourceKey && now.cut.sourceKey !== b.cut.sourceKey) {
      // Another source won the transaction: its physical history must not gain this program's markers.
      merged.cut = b.cut;
    } else if (was.cut && !b.cut && now.cut) {
      // A stale Done save cannot undo an explicit Start over committed after its render.
      delete merged.cut;
    } else if (now.cut && b.cut && !same(was.cut, now.cut)) {
      const keys = [...new Set([...b.cut.keys, ...now.cut.keys])];
      const startedKeys = [...new Set([...(b.cut.startedKeys ?? []), ...(now.cut.startedKeys ?? [])])];
      const startClaims = { ...b.cut.startClaims, ...now.cut.startClaims };
      merged.cut = {
        ...now.cut,
        at: Math.min(b.cut.at, now.cut.at),
        sourceKey: b.cut.sourceKey ?? now.cut.sourceKey,
        keys,
        ...(startedKeys.length && { startedKeys }),
        ...(Object.keys(startClaims).length && { startClaims }),
      };
      if (!(b.cut.all || now.cut.all) || !startedKeys.every(key => keys.includes(key))) delete merged.cut.all;
      else merged.cut.all = true;
    }
    return [merged];
  });
  const known = new Set(current.map(b => b.id));
  return [...kept, ...next.filter(b => !inBase.has(b.id) && !known.has(b.id))];
}

/**
 * A save is built from the job as last rendered (`base`), but another save may have come after that render (a drop, then
 * the blur of a size field, before React renders again). Saved as it is, `next` would undo that one. This applies only what
 * `next` changed from `base` to the job as it is now: the top-level fields, and per board its fields.
 */
export function rebaseJob(base: CamJobV1, next: CamJobV1, current: CamJobV1): CamJobV1 {
  if (same(base, current)) return next;
  const { boards: baseBoards, ...baseRest } = base;
  const { boards: nextBoards, ...nextRest } = next;
  const { boards: currentBoards, ...currentRest } = current;
  const rest = rebaseFields<Omit<CamJobV1, 'boards'>>(baseRest, nextRest, currentRest);
  const boards = same(baseBoards, nextBoards)
    ? currentBoards
    : nextBoards && rebaseBoards(baseBoards ?? [], nextBoards, currentBoards ?? []);
  return { ...rest, ...(boards && { boards }) } as CamJobV1;
}
