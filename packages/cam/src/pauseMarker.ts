/**
 * The marker camNC writes on its own line just before each M0 of a program it generated, saying what the pause is for,
 * so that the machine view can show it as steps and mark the parts without reading the message. Other senders only
 * show the M0's MSG; FluidNC skips the comment.
 */
export type PauseMarker =
  | { kind: 'start'; rpm: number }
  | { kind: 'take-out'; n: number; of: number; part: string; next?: string }
  | { kind: 'tab'; n: number; of: number; part: string }
  | { kind: 'done' };

const kMarker = 'CAMNC PAUSE';

/** `(CAMNC PAUSE take-out; n=2/5; part=Part 1b; next=Part 2)`: one comment line just before the M0. */
export function pauseMarker(m: PauseMarker): string {
  const fields: string[] = [m.kind];
  if ('n' in m) fields.push(`n=${m.n}/${m.of}`);
  if ('rpm' in m) fields.push(`rpm=${Math.round(m.rpm)}`);
  if ('part' in m) fields.push(`part=${clean(m.part)}`);
  if ('next' in m && m.next) fields.push(`next=${clean(m.next)}`);
  return `(${kMarker} ${fields.join('; ')})`;
}

/** The marker in a comment's text (without the parentheses), or null. Inverse of `pauseMarker`. */
export function parsePauseMarker(comment: string): PauseMarker | null {
  if (!comment.startsWith(`${kMarker} `)) return null;
  const [kind, ...rest] = comment
    .slice(kMarker.length + 1)
    .split(';')
    .map(s => s.trim());
  const f = Object.fromEntries(rest.map(s => [s.slice(0, s.indexOf('=')), s.slice(s.indexOf('=') + 1)]));
  const [n, of] = (f.n ?? '').split('/').map(Number);
  const counted = Number.isFinite(n) && Number.isFinite(of) && n! > 0 && of! > 0;
  if (kind === 'start') return { kind, rpm: Number(f.rpm) || 0 };
  if (kind === 'done') return { kind };
  if (kind === 'take-out' && counted && f.part) return { kind, n: n!, of: of!, part: f.part, ...(f.next && { next: f.next }) };
  if (kind === 'tab' && counted && f.part) return { kind, n: n!, of: of!, part: f.part };
  return null;
}

/** Inside a `( )` comment and between our `;` separators: no parentheses or semicolons, one line, short. */
const clean = (text: string) => text.replace(/[();]/g, '').replace(/\s+/g, ' ').trim().slice(0, 38);
