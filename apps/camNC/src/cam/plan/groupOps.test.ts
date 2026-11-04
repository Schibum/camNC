import { describe, expect, it } from 'vitest';
import type { OpSummary } from '../camTypes';
import { groupOps } from './groupOps';

const op = (label: string, over: Partial<OpSummary> = {}): OpSummary => ({
  name: label,
  label,
  kind: 'profile',
  tool: { number: 1, diameter: 3.175 },
  zTop: 8,
  zBottom: -0.3,
  depthSteps: 3,
  stepdown: 1.5,
  feeds: [1800, 900],
  timeMin: 0.5,
  ...over,
});

describe('guided programs', () => {
  it('are one row, whatever each step is called', () => {
    const program = { kind: 'free' as const, title: 'Cut the parts free', note: '2 pauses: take out each part' };
    const rows = groupOps([op('hole'), op('a · Cut free', { program }), op('b · Cut free', { program, timeMin: 1 })]);
    expect(rows.map(r => [r.label, r.count, r.note])).toEqual([
      ['hole', 1, undefined],
      ['Cut the parts free', 2, program.note],
    ]);
    expect(rows[1].timeMin).toBe(1.5);
  });
});

describe('groupOps', () => {
  it('shows identical operations of a part once, with a count and the total time', () => {
    const rows = groupOps([
      op('vert1 · Pocket 4.2 deep', { kind: 'pocket', zBottom: 3.8, timeMin: 2 }),
      op('vert1 · Through hole'),
      op('vert1 · Through hole'),
      op('vert1 · Through hole'),
      op('vert1 · Outline: rough + final pass', { timeMin: 3 }),
    ]);
    expect(rows.map(r => [r.label, r.count, r.members, r.timeMin])).toEqual([
      ['vert1 · Pocket 4.2 deep', 1, [0], 2],
      ['vert1 · Through hole', 3, [1, 2, 3], 1.5],
      ['vert1 · Outline: rough + final pass', 1, [4], 3],
    ]);
  });

  it('keeps operations apart that differ in bit, depth or feed, or belong to another part', () => {
    const rows = groupOps([
      op('left · Through hole'),
      op('left · Through hole', { tool: { number: 2, diameter: 6 } }),
      op('left · Through hole', { zBottom: -0.5 }),
      op('left · Through hole', { feeds: [1800] }),
      op('right · Through hole'),
    ]);
    expect(rows.map(r => r.count)).toEqual([1, 1, 1, 1, 1]);
  });
});
