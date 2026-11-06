import { describe, expect, it } from 'vitest';
import { parseGCode } from './gcodeParsing';
import { Vector3 } from 'three';
import { progressPointIndex, snapProgressToTool, trailBehind } from './jobProgress';

describe('job progress', () => {
  const gcode = 'G21\nG90\nG0 X0 Y0\nG1 X10 Y0 F100\nG1 X10 Y10\nG1 X0 Y10\nG1 X0 Y0\n';

  it('maps the SD percentage to a point index', () => {
    const toolpath = parseGCode(gcode);
    expect(progressPointIndex(toolpath, 0)).toBe(0);
    expect(progressPointIndex(toolpath, 100)).toBe(toolpath.pathPoints.length);
    const half = progressPointIndex(toolpath, 60);
    expect(half).toBeGreaterThan(0);
    expect(half).toBeLessThan(toolpath.pathPoints.length);
  });

  it('counts the points of arcs by their line, however many of them a line makes', () => {
    const arcs = Array.from({ length: 10 }, () => 'G3 X0 Y0 I5 J0');
    const straight = Array.from({ length: 10 }, (_, i) => `G1 X${i + 1} Y0`);
    const text = ['G1 X0 Y0 F100', ...arcs, ...straight].join('\n') + '\n';
    const toolpath = parseGCode(text);
    const byteOfLine = (line: number) => text.split('\n').slice(0, line).join('\n').length + 1;
    const percentAt = (line: number) => ((byteOfLine(line) + 0.5) / text.length) * 100;
    const pointsOfLine = (line: number) => toolpath.lines.filter(l => l <= line).length;
    // Half way through the lines, the arcs are done: well past half of the points.
    expect(progressPointIndex(toolpath, percentAt(11))).toBe(pointsOfLine(11));
    expect(pointsOfLine(11) / toolpath.pathPoints.length).toBeGreaterThan(0.9);
    expect(progressPointIndex(toolpath, percentAt(16))).toBe(pointsOfLine(16));
  });

  it('counts the progress in bytes', () => {
    const text = '(äöü äöü äöü äöü äöü)\nG1 X10 F100\nG1 X20\n';
    const toolpath = parseGCode(text);
    const bytes = new TextEncoder().encode(text).length;
    const firstLine = new TextEncoder().encode('(äöü äöü äöü äöü äöü)\n').length;
    expect(progressPointIndex(toolpath, ((firstLine - 1) / bytes) * 100)).toBe(0);
    expect(progressPointIndex(toolpath, ((firstLine + 0.5) / bytes) * 100)).toBe(toolpath.lines.filter(l => l <= 1).length);
    expect(progressPointIndex(toolpath, 100)).toBe(toolpath.pathPoints.length);
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
