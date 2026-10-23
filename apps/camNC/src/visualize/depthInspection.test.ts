import { Color, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import {
  buildDepthGeometryData,
  closestPointOnSegment,
  contrastRatio,
  fadeOutsideLevel,
  getCutDepthLevels,
  getCutZRange,
  getLevelSegmentPositions,
  getStockFootprint,
  guessZeroAt,
  isRapidSegment,
  withMinContrast,
} from './depthInspection';
import { parseGCode } from './gcodeParsing';

const darkBackground = new Color('#111318');

const twoPassGcode = `
G0 X0 Y0 Z5
G1 Z-1 F100
G1 X10
G1 Y10
G1 Z-2
G1 X0
G0 Z5
`;

describe('getCutDepthLevels', () => {
  it('lists horizontal cutting levels from deepest to highest with their lengths', () => {
    const levels = getCutDepthLevels(parseGCode(twoPassGcode));
    expect(levels).toHaveLength(2);
    expect(levels[0].z).toBeCloseTo(-2);
    expect(levels[0].length).toBeCloseTo(10);
    expect(levels[1].z).toBeCloseTo(-1);
    expect(levels[1].length).toBeCloseTo(20);
  });

  it('ignores rapid moves and plunges', () => {
    const levels = getCutDepthLevels(parseGCode('G0 X0 Y0 Z5\nG0 X20\nG1 Z-3 F100'));
    expect(levels).toEqual([]);
  });

  it('drops levels with negligible horizontal travel', () => {
    const levels = getCutDepthLevels(parseGCode('G0 X0 Y0 Z1\nG1 Z-1 F100\nG1 X0.5\nG1 Z-2\nG1 X10'));
    expect(levels.map(l => l.z)).toEqual([-2]);
    expect(getCutDepthLevels(parseGCode('G0 X0 Y0 Z1\nG1 Z-1 F100\nG1 X0.5'), { minLength: 0 })).toHaveLength(1);
  });

  it('includes arcs at a constant depth', () => {
    const levels = getCutDepthLevels(parseGCode('G0 X0 Y0 Z1\nG1 Z-0.5 F100\nG2 X10 Y0 I5 J0'));
    expect(levels).toHaveLength(1);
    expect(levels[0].z).toBeCloseTo(-0.5);
    expect(levels[0].length).toBeCloseTo(Math.PI * 5, 1);
  });
});

describe('buildDepthGeometryData', () => {
  it('splits rapid and cutting segments and maps them back to path points', () => {
    const toolpath = parseGCode(twoPassGcode);
    const data = buildDepthGeometryData(toolpath, darkBackground);
    const cutCount = data.cutSegmentIndex.length;
    const rapidCount = data.rapidSegmentIndex.length;

    expect(data.cutPositions).toHaveLength(cutCount * 6);
    expect(data.cutColors).toHaveLength(cutCount * 6);
    expect(data.rapidPositions).toHaveLength(rapidCount * 6);
    expect(cutCount).toBe(5);
    expect(Array.from(data.rapidSegmentIndex).every(i => isRapidSegment(toolpath, i))).toBe(true);
    expect(Array.from(data.cutSegmentIndex).some(i => isRapidSegment(toolpath, i))).toBe(false);

    const last = data.cutSegmentIndex[cutCount - 1];
    expect(Array.from(data.cutPositions.slice(-3))).toEqual([toolpath.pathPoints[last].x, toolpath.pathPoints[last].y, -2]);
  });
});

describe('guessZeroAt', () => {
  it('guesses the stock bottom for toolpaths that stay above 0 and rise above the stock top', () => {
    expect(guessZeroAt(parseGCode('G0 Z25\nG1 X10 Z12 F100\nG1 X20'), 20)).toBe('bottom');
  });

  it('guesses the stock top for toolpaths cutting below 0, or without a stock height', () => {
    expect(guessZeroAt(parseGCode('G0 Z5\nG1 X10 Z-2 F100'), 20)).toBe('top');
    expect(guessZeroAt(parseGCode('G0 Z25\nG1 X10 Z12 F100'), 0)).toBe('top');
  });
});

describe('getStockFootprint', () => {
  it('pads the toolpath bounds by 5% of their larger side', () => {
    const footprint = getStockFootprint(parseGCode('G1 X40 Y20 Z-1 F100'));
    expect(footprint.min.toArray()).toEqual([-2, -2]);
    expect(footprint.max.toArray()).toEqual([42, 22]);
  });
});

describe('closestPointOnSegment', () => {
  it('projects onto the segment and clamps to its ends', () => {
    const toolpath = parseGCode('G0 X0 Y0 Z0\nG1 X10 Z-2 F100');
    const last = toolpath.pathPoints.length - 1;
    expect(closestPointOnSegment(toolpath, last, new Vector3(5, 3, -1)).toArray()).toEqual([5, 0, -1]);
    expect(closestPointOnSegment(toolpath, last, new Vector3(20, 0, 0)).toArray()).toEqual([10, 0, -2]);
  });
});

describe('withMinContrast', () => {
  const darkestPlasma = new Color('#0d0887');

  it('lifts dark colors on a dark background and keeps the hue', () => {
    const lifted = withMinContrast(darkestPlasma, darkBackground);
    expect(contrastRatio(lifted, darkBackground)).toBeGreaterThanOrEqual(4.5);
    expect(lifted.getHSL({ h: 0, s: 0, l: 0 }).h).toBeCloseTo(darkestPlasma.getHSL({ h: 0, s: 0, l: 0 }).h, 2);
  });

  it('darkens light colors on a light background', () => {
    const lifted = withMinContrast(new Color('#f0f921'), new Color('#ffffff'));
    expect(contrastRatio(lifted, new Color('#ffffff'))).toBeGreaterThanOrEqual(4.5);
  });

  it('leaves colors with enough contrast unchanged', () => {
    const yellow = new Color('#f0f921');
    expect(withMinContrast(yellow, darkBackground).equals(yellow)).toBe(true);
  });

  it('gives every toolpath vertex enough contrast', () => {
    const { cutColors } = buildDepthGeometryData(parseGCode(twoPassGcode), darkBackground);
    for (let i = 0; i < cutColors.length; i += 3) {
      const color = new Color(cutColors[i], cutColors[i + 1], cutColors[i + 2]);
      expect(contrastRatio(color, darkBackground)).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe('getCutZRange', () => {
  it('spans from the deepest cut to the highest cut level, ignoring rapids and retract plunges', () => {
    expect(getCutZRange(parseGCode(twoPassGcode))).toEqual({ min: -2, max: -1 });
  });

  it('falls back to the cut endpoints without horizontal levels', () => {
    expect(getCutZRange(parseGCode('G0 X0 Y0 Z5\nG1 Z-3 F100'))).toEqual({ min: -3, max: 5 });
  });

  it('falls back to the bounds without cutting moves', () => {
    expect(getCutZRange(parseGCode('G0 X0 Y0 Z5\nG0 X10 Z2'))).toEqual({ min: 0, max: 5 });
  });
});

describe('level highlighting', () => {
  const positions = new Float32Array([0, 0, -1, 10, 0, -1, 10, 0, -1, 10, 0, -2, 10, 0, -2, 0, 0, -2]);
  const colors = new Float32Array([1, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1]);

  it('selects the segments at a level', () => {
    expect([...getLevelSegmentPositions(positions, -2)]).toEqual([10, 0, -2, 0, 0, -2]);
    expect(getLevelSegmentPositions(positions, -3)).toHaveLength(0);
  });

  it('keeps the colors of the level and fades the others', () => {
    const faded = fadeOutsideLevel(positions, colors, -2, new Color(0, 0, 0));
    expect([...faded.subarray(12)]).toEqual([0, 0, 1, 0, 0, 1]);
    // Grayed: equal components, darker than the original red.
    expect(faded[0]).toBeCloseTo(faded[1]);
    expect(faded[0]).toBeLessThan(1);
  });
});
