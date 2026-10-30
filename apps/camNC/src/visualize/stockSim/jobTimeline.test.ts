import { describe, expect, it } from 'vitest';
import { parseGCode } from '../gcodeParsing';
import { computeJobTimes, formatDuration, getTimelineMarks, playheadAt } from './jobTimeline';

describe('job timeline', () => {
  // 10 mm at F600 takes 1 s, 10 mm rapid at 6000 mm/min takes 0.1 s.
  const gcode = ['G21 G90', '', 'G0 X0 Y0 Z1', 'G1 Z-1 F60', 'G1 X10 F600', 'G0 Z1', 'G0 X20', 'T2', 'G1 Z-2 F60', 'G1 X30 F600'].join(
    '\n'
  );
  const toolpath = parseGCode(gcode);

  it('records the feed rate and source line of each point', () => {
    const last = toolpath.pathPoints.length - 1;
    expect(toolpath.feeds).toHaveLength(toolpath.pathPoints.length);
    expect(toolpath.lines[last]).toBe(10);
    expect(toolpath.feeds[last]).toBe(600);
    // Blank line 2 is skipped by the interpreter but still counted.
    expect(toolpath.lines[1]).toBe(3);
  });

  it('estimates the time at each point from feeds and the rapid rate', () => {
    const times = computeJobTimes(toolpath, 6000);
    const total = times[times.length - 1];
    // Z1 plunge 2 mm @60 = 2 s, 10 mm @600 = 1 s, rapids 2+10 mm @6000 = 0.12 s, plunge 3 mm @60 = 3 s, 10 mm @600 = 1 s.
    const first = (1 / 6000) * 60; // G0 from the origin to Z1.
    expect(total).toBeCloseTo(first + 2 + 1 + 0.12 + 3 + 1, 5);
    for (let i = 1; i < times.length; i++) expect(times[i]).toBeGreaterThanOrEqual(times[i - 1]);
  });

  it('finds the segment and the share of it done at a time', () => {
    const times = new Float64Array([0, 1, 1, 3]);
    expect(playheadAt(times, 0.5)).toEqual({ index: 1, fraction: 0.5 });
    expect(playheadAt(times, 2)).toEqual({ index: 3, fraction: 0.5 });
    expect(playheadAt(times, 10)).toEqual({ index: 3, fraction: 1 });
    expect(playheadAt(times, -1)).toEqual({ index: 1, fraction: 0 });
  });

  it('marks tool changes and new depths', () => {
    const marks = getTimelineMarks(toolpath, computeJobTimes(toolpath));
    expect(marks.map(m => m.label)).toEqual(['Z -1.00', 'Tool T2', 'Z -2.00']);
  });

  it('formats durations', () => {
    expect(formatDuration(59.6)).toBe('1:00');
    expect(formatDuration(3725)).toBe('1:02:05');
  });
});
