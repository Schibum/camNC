import type { CadConstraint } from './types';

/** Logical coincidence never rewrites source point IDs or merges their dimensions. */
export interface CadPointEquivalence {
  canonical(pointId: string): string;
  equivalent(a: string, b: string): boolean;
  members(pointId: string): readonly string[];
  expand(pointIds: Iterable<string>): Set<string>;
  match(a: Iterable<string>, b: Iterable<string>): [string, string] | undefined;
}

/** A derived, order-independent index of explicit transitive coincidence relations. */
export function pointEquivalence(constraints: readonly CadConstraint[]): CadPointEquivalence {
  const parents = new Map<string, string>();
  const canonical = (id: string): string => {
    let root = id;
    while (parents.has(root) && parents.get(root) !== root) root = parents.get(root)!;
    let current = id;
    while (parents.has(current) && parents.get(current) !== root) {
      const next = parents.get(current)!;
      parents.set(current, root);
      current = next;
    }
    return root;
  };
  for (const constraint of constraints) {
    if (constraint.type !== 'coincident') continue;
    const a = canonical(constraint.pointAId),
      b = canonical(constraint.pointBId);
    parents.set(a, a < b ? a : b);
    parents.set(b, a < b ? a : b);
  }
  const groups = new Map<string, string[]>();
  for (const id of parents.keys()) {
    const root = canonical(id);
    const members = groups.get(root) ?? [];
    members.push(id);
    groups.set(root, members);
  }
  for (const members of groups.values()) members.sort();
  const members = (id: string): readonly string[] => groups.get(canonical(id)) ?? [id];
  return {
    canonical,
    equivalent: (a, b) => canonical(a) === canonical(b),
    members,
    expand: ids => new Set([...ids].flatMap(id => [...members(id)])),
    match: (a, b) => {
      const right = [...b];
      for (const left of a) {
        const match = right.find(id => canonical(left) === canonical(id));
        if (match !== undefined) return [left, match];
      }
      return undefined;
    },
  };
}
