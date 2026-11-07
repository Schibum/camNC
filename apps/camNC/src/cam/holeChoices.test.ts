import { describe, expect, it } from 'vitest';
import { discardMissingHoleChoices, holeChoiceKey, holeChoicesForPart } from './holeChoices';

describe('source identity for through-hole choices', () => {
  it('resolves native loop IDs after area ordering changes without moving a choice to a different hole', () => {
    const choices = { 'loop-a': 'leave', 'loop-b': 'clear' } as const;
    expect(holeChoicesForPart({ holeIds: ['loop-a', 'loop-b'] }, choices)).toEqual({ 0: 'leave', 1: 'clear' });
    expect(holeChoicesForPart({ holeIds: ['loop-b', 'loop-a'] }, choices)).toEqual({ 0: 'clear', 1: 'leave' });
    expect(holeChoicesForPart({ holeIds: ['loop-c', 'loop-a'] }, choices)).toEqual({ 1: 'leave' });
    expect(choices).toEqual({ 'loop-a': 'leave', 'loop-b': 'clear' });
  });

  it('never falls back to a numeric index for native geometry, including stale and orphaned references', () => {
    expect(holeChoiceKey({ holeIds: ['loop-a'] }, 0)).toBe('loop-a');
    expect(holeChoiceKey({ holeIds: ['loop-a'] }, 1)).toBeUndefined();
    expect(holeChoiceKey({ holeIds: [] }, 0)).toBeUndefined();
    expect(holeChoicesForPart({ holeIds: ['loop-new'] }, { 0: 'clear', 'loop-old': 'leave' })).toBeUndefined();
  });

  it('preserves numeric-index choices for imported STEP/STL parts', () => {
    expect(holeChoiceKey({}, 2)).toBe('2');
    expect(holeChoicesForPart({}, { 0: 'clear', 2: 'leave' })).toEqual({ 0: 'clear', 2: 'leave' });
    expect(holeChoicesForPart({}, { 'orphan-native-id': 'clear' })).toBeUndefined();
  });

  it('discards only explicit orphan keys without mutating retained settings', () => {
    const choices = { part: { retained: 'leave', removed: 'clear' }, other: { 0: 'clear' } } as const;
    expect(discardMissingHoleChoices(choices, [{ partId: 'part', holeId: 'removed', choice: 'clear' }])).toEqual({
      part: { retained: 'leave' },
      other: { 0: 'clear' },
    });
    expect(choices.part.removed).toBe('clear');
  });
});
