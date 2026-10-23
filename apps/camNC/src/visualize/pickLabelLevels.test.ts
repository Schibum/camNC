import { describe, expect, it } from 'vitest';
import { pickLabelLevels } from './depthInspection';

const levels = [-6, -5.9, -4, -2, -1.95].map(z => ({ z, length: 10 }));

describe('pickLabelLevels', () => {
  it('labels every level when they are far enough apart', () => {
    expect(pickLabelLevels(levels, 1000, null)).toEqual([-6, -5.9, -4, -2, -1.95]);
  });

  it('skips levels that would overlap the previous label', () => {
    // 20px per mm: 0.1mm apart is 2px, too close.
    expect(pickLabelLevels(levels, 20, null)).toEqual([-6, -4, -2]);
  });

  it('always labels the selected level, dropping labels too close to it', () => {
    expect(pickLabelLevels(levels, 20, -5.9)).toEqual([-5.9, -4, -2]);
  });
});
