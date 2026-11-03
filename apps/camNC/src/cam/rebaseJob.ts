import type { CamJobV1 } from './jobDb';

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
    if (was && !now) return [];
    return [was && now ? rebaseFields(was, now, b) : b];
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
