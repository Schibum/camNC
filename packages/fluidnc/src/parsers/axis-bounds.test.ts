import { describe, expect, it } from 'vitest';
import { computeAxisBounds } from './axis-bounds';

describe('computeAxisBounds', () => {
  it('homes in positive direction by default', () => {
    expect(computeAxisBounds({ max_travel_mm: 600, homing: { mpos_mm: 600 } })).toEqual({ min: 0, max: 600 });
  });

  it('reads positive_direction from the homing section', () => {
    expect(computeAxisBounds({ max_travel_mm: 600, homing: { mpos_mm: 5, positive_direction: false } })).toEqual({
      min: 5,
      max: 605,
    });
  });

  it('treats axes without homing as positive with mpos 0', () => {
    expect(computeAxisBounds({ max_travel_mm: 300 })).toEqual({ min: -300, max: 0 });
  });
});
