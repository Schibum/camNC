import { describe, expect, it } from 'vitest';
import type { OpSummary, PlanResult, ReleaseProgram } from '../camTypes';
import { isRapidSegment } from '@/visualize/depthInspection';
import { buildPlanModel, onlyOps, timelineLayout, timeToX, xToTime } from './planModel';
import { kOpPalette } from './palette';

const op = (label: string, kind: OpSummary['kind'] = 'pocket'): OpSummary => ({
  name: label,
  label,
  kind,
  tool: { number: 1, diameter: 3.175 },
  zTop: 8.3,
  zBottom: -0.3,
  depthSteps: 2,
  stepdown: 1.5,
  feeds: [800],
  timeMin: 0.1,
});

/** Two identical holes and an outline, with the markers the CAM core writes. */
function plan(): PlanResult {
  const hole = (x: number) => [`G0 X${x} Y20`, 'G1 Z4 F300', `G1 X${x + 2} F800`, 'G1 Z-0.3 F300', `G1 X${x} F800`, 'G0 Z15'];
  const gcode = [
    'G21 G90',
    'G0 Z15',
    '(OP 1/3 a: Hole - T1 D=3.175)',
    ...hole(10),
    '(OP 2/3 a: Hole - T1 D=3.175)',
    ...hole(40),
    '(OP 3/3 a: Outline - T1 D=3.175)',
    'G0 X0 Y0',
    'G1 Z4 F300',
    'G1 X100 F800',
    'G1 Y50',
    'G0 Z15',
    'M2',
  ].join('\n');
  return {
    gcode,
    timeMin: 1,
    warnings: [],
    safety: [],
    ops: [op('a · Through hole'), op('a · Through hole'), op('a · Outline', 'profile')],
    bits: [3.175],
    programs: [{ tool: 1, diameter: 3.175, gcode, timeMin: 1 }],
    size: [100, 50, 8.3],
    path: [],
  };
}

describe('guided programs after the cutting', () => {
  it('follow the program on the timeline, with their pauses and bands, not the spindle confirmation', () => {
    const base = plan();
    const gcode = [
      'G21 G90',
      'G0 Z15',
      'M0 (MSG Spindle starts at 15000 RPM next. Manual spindle: turn it on now)',
      '(OP 1/2 a: Free - T1 D=3.175)',
      'G0 X5 Y5',
      'G1 Z-0.3 F300',
      'G1 X25 F800',
      'G0 Z15',
      'M5',
      'M0 (MSG Take out a, then continue)',
      '(OP 2/2 b: Free - T1 D=3.175)',
      'G0 X50',
      'G1 Z-0.3 F300',
      'G1 X70 F800',
      'G0 Z15',
      'M5',
      'M0 (MSG Take out b, then continue)',
      'M30',
    ].join('\n');
    const program = { kind: 'free' as const, title: 'Cut the parts free', note: '2 pauses: take out each part' };
    const release = [
      {
        kind: 'free',
        title: 'Cut the parts free',
        gcode,
        timeMin: 1,
        tool: 7,
        diameter: 6,
        pauses: 2,
        note: program.note,
        safety: [],
        turned: false,
        ops: [
          { ...op('a'), program },
          { ...op('b'), program },
        ],
      },
    ] as ReleaseProgram[];
    const without = buildPlanModel(base);
    const m = buildPlanModel(base, release);
    expect(m.total).toBeGreaterThan(without.total);
    expect(m.ops).toHaveLength(without.ops.length + 2);
    expect(m.summaries).toHaveLength(m.ops.length);
    // One row for both laps, last.
    expect(m.groups.at(-1)!.label).toBe('Cut the parts free');
    expect(m.ops.at(-1)!.group).toBe(m.groups.length - 1);
    expect(m.ops.at(-2)!.group).toBe(m.groups.length - 1);
    expect(m.ops.at(-2)!.start).toBeGreaterThanOrEqual(without.total);
    expect(m.pauses.map(p => p.label)).toEqual(['Take out a, then continue', 'Take out b, then continue']);
    // After each lap, in order.
    expect(m.pauses[0].time).toBeGreaterThanOrEqual(m.ops.at(-2)!.end - 1e-6);
    expect(m.pauses[0].time).toBeLessThanOrEqual(m.ops.at(-1)!.start + 1e-6);
    expect(m.pauses[1].time).toBeGreaterThanOrEqual(m.ops.at(-1)!.end - 1e-6);
    expect(m.bits.get(7)).toBe(6);
    expect(without.pauses).toEqual([]);
  });
});

describe('plan model', () => {
  it('splits the program into its ops, groups identical ones and gives each group one color', () => {
    const model = buildPlanModel(plan());
    expect(model.ops).toHaveLength(3);
    expect(model.groups.map(g => [g.label, g.count, g.color])).toEqual([
      ['a · Through hole', 2, kOpPalette[0]],
      ['a · Outline', 1, kOpPalette[1]],
    ]);
    expect(model.ops.map(o => o.group)).toEqual([0, 0, 1]);
    // In cut order, back to back, within the program.
    for (let i = 1; i < model.ops.length; i++) expect(model.ops[i].start).toBeGreaterThanOrEqual(model.ops[i - 1].end - 1e-9);
    expect(model.ops[2].end).toBeLessThanOrEqual(model.total);
    // The first hole's moves end at x 10..12, the outline's reach x 100.
    const xs = (o: (typeof model.ops)[number]) => model.toolpath.pathPoints.slice(o.from, o.to + 1).map(p => p.x);
    expect(Math.max(...xs(model.ops[0]))).toBe(12);
    expect(Math.max(...xs(model.ops[2]))).toBe(100);
  });

  it('simulates one op group alone: every other move becomes a rapid', () => {
    const model = buildPlanModel(plan());
    const holes = model.ops.filter(o => o.group === 0);
    const only = onlyOps(model.toolpath, holes);
    const cutting = (t: typeof only) => t.pathPoints.map((_, i) => i).filter(i => i > 0 && !isRapidSegment(t, i));
    const outline = model.ops[2];
    expect(cutting(only).every(i => holes.some(o => i >= o.from && i <= o.to))).toBe(true);
    expect(cutting(only).length).toBeGreaterThan(0);
    expect(cutting(model.toolpath).some(i => i >= outline.from && i <= outline.to)).toBe(true);
  });
});

describe('timeline layout', () => {
  const ops = [
    { start: 0, end: 600 },
    { start: 600, end: 603 },
    { start: 610, end: 1200 },
  ];

  it('gives each op a band as wide as its time, in order, without overlap', () => {
    const { bands } = timelineLayout(ops, 1200, 0);
    expect(bands[0].left).toBe(0);
    expect(bands[0].width).toBeCloseTo(0.5);
    expect(bands[1].left).toBeCloseTo(0.5);
    expect(bands[2].left + bands[2].width).toBeCloseTo(1);
    for (let i = 1; i < bands.length; i++) expect(bands[i].left).toBeGreaterThanOrEqual(bands[i - 1].left + bands[i - 1].width - 1e-9);
  });

  it('keeps a 3 s op visible in a 20 min program', () => {
    const { bands } = timelineLayout(ops, 1200, 0.01);
    expect(bands[1].width).toBeGreaterThanOrEqual(0.0099);
    expect(bands.reduce((s, b) => s + b.width, 0)).toBeLessThanOrEqual(1);
    expect(bands[2].left + bands[2].width).toBeCloseTo(1);
  });

  it('maps time to the track and back, the playhead on the band edges at op starts and ends', () => {
    const { bands, knots } = timelineLayout(ops, 1200, 0.01);
    expect(timeToX(knots, 0)).toBe(0);
    expect(timeToX(knots, 1200)).toBeCloseTo(1);
    expect(timeToX(knots, 600)).toBeCloseTo(bands[1].left);
    expect(timeToX(knots, 603)).toBeCloseTo(bands[1].left + bands[1].width);
    expect(timeToX(knots, 610)).toBeCloseTo(bands[2].left);
    for (const t of [0, 100, 601.5, 605, 900, 1200]) expect(xToTime(knots, timeToX(knots, t))).toBeCloseTo(t, 6);
    // Monotonic.
    let last = -1;
    for (let t = 0; t <= 1200; t += 7) {
      const x = timeToX(knots, t);
      expect(x).toBeGreaterThanOrEqual(last);
      last = x;
    }
  });
});
