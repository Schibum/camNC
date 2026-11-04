import { describe, expect, it } from 'vitest';
import { parsePauseMarker, pauseMarker, type PauseMarker } from './pauseMarker';

const comment = (m: PauseMarker) => pauseMarker(m).slice(1, -1);

describe('pause markers', () => {
  it('read back what was written, for every kind', () => {
    const markers: PauseMarker[] = [
      { kind: 'start', rpm: 18000 },
      { kind: 'take-out', n: 2, of: 5, part: 'Part 1b', next: 'Part 2' },
      { kind: 'take-out', n: 5, of: 5, part: 'Part 4' },
      { kind: 'tab', n: 3, of: 8, part: 'Seite links' },
      { kind: 'done' },
    ];
    for (const m of markers) expect(parsePauseMarker(comment(m))).toEqual(m);
    expect(pauseMarker(markers[1]!)).toBe('(CAMNC PAUSE take-out; n=2/5; part=Part 1b; next=Part 2)');
  });

  it('keeps names inside the comment and the line short', () => {
    const line = pauseMarker({ kind: 'take-out', n: 12, of: 12, part: 'a (left); b'.repeat(10), next: 'x'.repeat(100) });
    expect(line.slice(1, -1)).not.toMatch(/[()]/);
    expect(line.length).toBeLessThanOrEqual(127);
    expect(parsePauseMarker(line.slice(1, -1))).toMatchObject({ kind: 'take-out', n: 12, of: 12 });
  });

  it('is null for other comments and broken markers', () => {
    expect(parsePauseMarker('MSG Take out Part 1b')).toBeNull();
    expect(parsePauseMarker('CAMNC PAUSE take-out; part=a')).toBeNull();
    expect(parsePauseMarker('CAMNC PAUSE something')).toBeNull();
  });
});
