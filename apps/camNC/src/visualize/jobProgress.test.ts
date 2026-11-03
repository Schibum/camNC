import { describe, expect, it } from 'vitest';
import { parseGCode } from './gcodeParsing';
import { Vector3 } from 'three';
import { motionLineEnds, progressPointIndex, snapProgressToTool, trailBehind } from './jobProgress';

describe('job progress', () => {
  const gcode = 'G21\nG90\nG0 X0 Y0\nG1 X10 Y0 F100\nG1 X10 Y10\nG1 X0 Y10\nG1 X0 Y0\n';

  it('finds the end of every motion line', () => {
    expect(motionLineEnds(gcode)).toHaveLength(5);
    expect(motionLineEnds('G10 L20 P0 Z0\nG38.2 Z-5 F10\nG1 X1')).toHaveLength(1);
  });

  it('maps the SD percentage to a point index', () => {
    const toolpath = parseGCode(gcode);
    const ends = motionLineEnds(gcode);
    expect(progressPointIndex(toolpath, ends, 0)).toBe(0);
    expect(progressPointIndex(toolpath, ends, 100)).toBe(toolpath.pathPoints.length);
    const half = progressPointIndex(toolpath, ends, 60);
    expect(half).toBeGreaterThan(0);
    expect(half).toBeLessThan(toolpath.pathPoints.length);
  });

  describe('snapping to the tool', () => {
    // Two passes around a 10 mm square, at Z -1 and Z -2.
    const square = (z: number) => [new Vector3(10, 0, z), new Vector3(10, 10, z), new Vector3(0, 10, z), new Vector3(0, 0, z)];
    const points = [new Vector3(0, 0, 5), new Vector3(0, 0, -1), ...square(-1), new Vector3(0, 0, -2), ...square(-2)];

    it('splits at the tool when the read position runs ahead', () => {
      // File read up to the second pass's second side, tool halfway along the first side of the first pass.
      const split = snapProgressToTool(points, 9, new Vector3(5, 0, -1));
      expect(split?.index).toBe(2);
      expect(split?.point.toArray()).toEqual([5, 0, -1]);
    });

    it('tells stacked passes apart by depth', () => {
      expect(snapProgressToTool(points, 10, new Vector3(5, 0, -2))?.index).toBe(7);
    });

    it('falls back to the read position without a nearby tool', () => {
      expect(snapProgressToTool(points, 4, null)?.index).toBe(4);
      expect(snapProgressToTool(points, 4, new Vector3(50, 50, 0))?.point.toArray()).toEqual(points[3]!.toArray());
      expect(snapProgressToTool(points, 0, new Vector3(5, 0, -1))).toBeNull();
    });

    it('draws a trail of the given length behind the tool', () => {
      const trail = trailBehind(points, { index: 3, point: new Vector3(10, 4, -1) }, 6);
      expect(trail.map(p => p.toArray())).toEqual([
        [8, 0, -1],
        [10, 0, -1],
        [10, 4, -1],
      ]);
    });
  });
});
