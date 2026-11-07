import type { HoleChoice } from '@wbcnc/cam';
import type { EvaluatedCadPart } from '@wbcnc/cad';

/** Native keys name source loops; imported models retain their through-hole indices. */
export type HoleChoices = Record<string, Record<string, HoleChoice>>;
export interface HoleIdentity {
  holeIds?: readonly string[];
}
export interface MissingHoleChoice {
  partId: string;
  holeId: string;
  choice: HoleChoice;
}

export function holeChoiceKey(part: HoleIdentity, index: number): string | undefined {
  if (!Number.isInteger(index) || index < 0) return undefined;
  return part.holeIds ? part.holeIds[index] : String(index);
}

/** Resolve only current source IDs. An orphaned native choice must never move to another hole's index. */
export function holeChoicesForPart(
  part: HoleIdentity,
  choices: Record<string, HoleChoice> | undefined
): Record<number, HoleChoice> | undefined {
  if (!choices) return undefined;
  const entries = part.holeIds
    ? part.holeIds.flatMap((id, index) => (choices[id] ? [[index, choices[id]] as const] : []))
    : Object.entries(choices).flatMap(([key, choice]) => (/^(0|[1-9]\d*)$/.test(key) ? [[Number(key), choice] as const] : []));
  return entries.length ? Object.fromEntries(entries) : undefined;
}

/** Retain removed references for Undo/reentry, and make their non-application explicit. */
export function missingNativeHoleChoices(parts: readonly EvaluatedCadPart[], choices: HoleChoices | undefined): MissingHoleChoice[] {
  const current = new Map(parts.map(part => [part.partId, new Set(part.loops.filter(loop => loop.kind === 'hole').map(loop => loop.id))]));
  return Object.entries(choices ?? {}).flatMap(([partId, holes]) =>
    Object.entries(holes).flatMap(([holeId, choice]) => (current.get(partId)?.has(holeId) ? [] : [{ partId, holeId, choice }]))
  );
}

export function discardMissingHoleChoices(choices: HoleChoices | undefined, missing: readonly MissingHoleChoice[]): HoleChoices {
  const kept = Object.fromEntries(Object.entries(choices ?? {}).map(([part, holes]) => [part, { ...holes }]));
  for (const { partId, holeId } of missing) {
    if (!kept[partId]) continue;
    delete kept[partId]![holeId];
    if (!Object.keys(kept[partId]!).length) delete kept[partId];
  }
  return kept;
}
