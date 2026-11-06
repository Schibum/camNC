import { describe, expect, it } from 'vitest';
import { kDefaultPlan, withHoleChoice } from './planSettings';

describe('withHoleChoice', () => {
  it('keeps a choice per part and hole', () => {
    const one = withHoleChoice(kDefaultPlan, 'part-0', 2, 'clear');
    const two = withHoleChoice(one, 'part-0', 3, 'leave');
    expect(withHoleChoice(two, 'part-1', 2, 'leave').holes).toEqual({ 'part-0': { 2: 'clear', 3: 'leave' }, 'part-1': { 2: 'leave' } });
    expect(kDefaultPlan.holes).toBeUndefined();
  });

  it('no choice: size and time decide again', () => {
    const one = withHoleChoice(kDefaultPlan, 'part-0', 2, 'clear');
    expect(withHoleChoice(one, 'part-0', 2, undefined).holes).toEqual({ 'part-0': {} });
  });
});
