import { describe, expect, it } from 'vitest';
import { samePhysicalTool, toolIdentityKey, toolProgramKey } from './toolIdentity';
import type { Tool } from './toolpaths';

const tool: Tool = { guid: 'bit-a', number: 1, diameter: 3.175, fluteLength: 20, flutes: 2, stickout: 25 };

describe('physical tool identity', () => {
  it('excludes labels and cutting data but retains physical dimensions and library identity', () => {
    expect(samePhysicalTool(tool, { ...tool, name: 'renamed', feed: 900, plungeFeed: 300, stepdown: 1, stepover: 0.8, rpm: 18000 })).toBe(
      true
    );
    for (const change of [{ guid: 'bit-b' }, { number: 2 }, { diameter: 3 }, { fluteLength: 15 }, { flutes: 1 }, { stickout: 30 }])
      expect(toolIdentityKey({ ...tool, ...change })).not.toBe(toolIdentityKey(tool));
  });

  it('separates programs by spindle speed, including a configurable fallback', () => {
    expect(toolProgramKey(tool)).not.toBe(toolProgramKey({ ...tool, rpm: 18000 }));
    expect(toolProgramKey(tool, 18000)).toBe(toolProgramKey({ ...tool, rpm: 18000 }, 15000));
    expect(toolProgramKey({ ...tool, rpm: 12000 })).not.toBe(toolProgramKey({ ...tool, rpm: 18000 }));
  });
});
