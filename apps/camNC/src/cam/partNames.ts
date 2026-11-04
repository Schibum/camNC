import type { CamPartInfo } from './camTypes';

/** Names CAD programs give bodies nobody named: "Part 1", "Body2", "Körper 3". */
const kGeneric = /^(part|body|bauteil|körper|koerper|solid|component|komponente)\s*\d+$/i;
export const isGenericName = (name: string) => kGeneric.test(name.trim());

/** a, b, …, z, aa, ab, … */
function suffix(k: number): string {
  const s = String.fromCharCode(97 + (k % 26));
  return k < 26 ? s : suffix(Math.floor(k / 26) - 1) + s;
}

/**
 * One name per body of a group of identical bodies, the same on every step and in the G-code: bodies without a name
 * of their own (or with the same one) take the group's name plus a letter ("Part 1a", "Part 1b"); named bodies keep
 * theirs. Once the user renamed the group, all its bodies take the new name.
 */
export function bodyNames(groupName: string, names: string[], renamed = false): string[] {
  if (names.length === 1) return [groupName];
  const sep = /\d$/.test(groupName) ? '' : ' ';
  const needsLetter = (n: string) => renamed || isGenericName(n) || names.filter(m => m === n).length > 1;
  let k = 0;
  return names.map(n => (needsLetter(n) ? `${groupName}${sep}${suffix(k++)}` : n));
}

/** The model's parts under the job's names (renamed by the user), each body named as by `bodyNames`. */
export function withPartNames(parts: CamPartInfo[], jobParts: { id: string; name: string }[]): CamPartInfo[] {
  const names = new Map(jobParts.map(p => [p.id, p.name.trim()]));
  return parts.map(p => {
    const modelName = p.modelName ?? p.name;
    const name = names.get(p.id) || modelName;
    return { ...p, name, modelName, names: bodyNames(name, p.names, name !== modelName) };
  });
}
