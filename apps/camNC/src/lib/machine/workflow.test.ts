import { describe, expect, it } from 'vitest';
import { checkPosition, checkTravel, g53Targets, getJobChecklist, kHomeFirst, machineView, outsideTravel, zeroGhost } from './workflow';

describe('machineView', () => {
  it('switches to running while a job is active or the machine is running/held', () => {
    expect(machineView({ state: 'Idle', jobActive: false })).toBe('setup');
    expect(machineView({ state: 'Alarm', jobActive: false })).toBe('setup');
    expect(machineView({ state: 'Jog', jobActive: false })).toBe('setup');
    expect(machineView({ state: 'Run', jobActive: false })).toBe('running');
    expect(machineView({ state: 'Hold', jobActive: false })).toBe('running');
    expect(machineView({ state: 'Idle', jobActive: true })).toBe('running');
  });
});

describe('getJobChecklist', () => {
  const base = {
    gcode: 'G1 X10',
    homed: true,
    zZeroed: true,
    toolpathBounds: { min: { x: 0, y: 0 }, max: { x: 100, y: 100 } },
    toolpathOffset: { x: 50, y: 60 },
    machineZero: { x: 50, y: 60 },
    machineBounds: { min: { x: 3, y: 3 }, max: { x: 1223, y: 2443 } },
  };

  it('passes when everything is prepared', () => {
    expect(getJobChecklist(base).every(item => item.ok)).toBe(true);
  });

  it('flags missing homing, Z zero, XY mismatch, bounds and tool changes', () => {
    const items = getJobChecklist({
      ...base,
      gcode: 'G1 X10\nM6 T2',
      homed: false,
      zZeroed: false,
      toolpathOffset: { x: 1200, y: 60 },
    });
    expect(items.filter(i => !i.ok).map(i => i.id)).toEqual(['homed', 'bounds', 'xy-zero', 'z-zero', 'tool-change']);
  });

  it('warns, without blocking, when a program with moves in machine coordinates runs unhomed', () => {
    const home = (gcode: string, homed: boolean) => getJobChecklist({ ...base, gcode, homed }).find(i => i.id === 'homed')!;
    // camNC may have connected after the machine was homed.
    expect(home('G1 X10\nM5\nG53 G0 Z-5\nM30', false)).toEqual({ id: 'homed', ok: false, label: kHomeFirst });
    expect(home('G1 X10\nM5\nG53 G0 Z-5\nM30', true).blocking).toBeUndefined();
    expect(home('G1 X10', false).blocking).toBeUndefined();
    // A comment mentioning it doesn't count.
    expect(home('(G53 G0 Z-5)\nG1 X10', false).blocking).toBeUndefined();
  });

  it('accepts G-code that probes Z itself', () => {
    expect(getJobChecklist({ ...base, gcode: 'G38.2 Z-20 F100', zZeroed: false }).find(i => i.id === 'z-zero')?.ok).toBe(true);
  });
});

describe('checkTravel', () => {
  // The "winkel v6" job from a Jackpot2: Fusion ranges and the WCO it ran with; JP2 LowRider travel.
  const toolpathBounds = { min: { x: -3, y: -3, z: -9.5 }, max: { x: 144.614, y: 593, z: 8 } };
  const workOffset = { x: 307.28, y: 92.783, z: -22.1 };
  const travel = {
    x: { min: 3, max: 1223, softLimits: true },
    y: { min: 3, max: 2443, softLimits: true },
    z: { min: -297, max: 3, softLimits: true },
  };
  const gcode = 'G0 X0 Y0\nG1 Z-9.5\nG0 G53 Z0 F900\n';

  it('passes a job that stays within the travel, including its G53 retract', () => {
    expect(checkTravel({ toolpathBounds, workOffset, travel, gcode })).toEqual({
      id: 'travel',
      ok: true,
      label: 'Within the machine travel',
    });
  });

  it('blocks a job that would cut below the Z travel, with the numbers', () => {
    const item = checkTravel({ toolpathBounds, workOffset: { ...workOffset, z: -290 }, travel, gcode });
    expect(item.blocking).toBe(true);
    expect(item.details).toEqual([
      'Z would go to -299.5, 2.5 mm below the Z travel -297 to 3. The Z zero is too low, or the job cuts too deep.',
    ]);
  });

  it('only warns where the controller does not enforce soft limits', () => {
    const item = checkTravel({
      toolpathBounds,
      workOffset: { ...workOffset, x: 5 },
      travel: { ...travel, x: { ...travel.x, softLimits: false } },
      gcode,
    });
    expect(item.ok).toBe(false);
    expect(item.blocking).toBe(false);
    expect(item.details?.[0]).toBe(
      'X would go to 2, 1 mm below the X travel 3 to 1223. Move the X zero at least 1 mm up, or the job is too large.'
    );
  });

  it('checks G53 targets in machine coordinates and skips axes with unknown travel', () => {
    const item = checkTravel({ toolpathBounds, workOffset, travel: { ...travel, x: null }, gcode: gcode + 'G53 G0 Z5\n' });
    expect(item.details).toEqual([
      'Z would go to 5, 2 mm above the Z travel -297 to 3. The Z zero is too high, or the safe height is too large.',
    ]);
    expect(g53Targets('G0 G53 Z0 F900 (park)\nG53 X10.5 Y-2')).toEqual([
      { axis: 'z', value: 0 },
      { axis: 'x', value: 10.5 },
      { axis: 'y', value: -2 },
    ]);
  });
});

describe('getJobChecklist travel with open zero steps', () => {
  // Board A of 600 x 1000 x 20.8 mm, with the zero an earlier job left on the controller.
  const travel = {
    x: { min: 3, max: 621, softLimits: true },
    y: { min: 3, max: 1241, softLimits: true },
    z: { min: -97, max: 3, softLimits: true },
  };
  const bounds = { min: { x: 0, y: 0, z: -0.3 }, max: { x: 572.71, y: 981.71, z: 25.8 } };
  const base = {
    gcode: 'G1 X10\nG53 G0 Z-5',
    homed: true,
    zZeroed: false,
    toolpathOffset: { x: 14.3, y: 118.7 },
    machineZero: { x: 6.48, y: 416.49 },
    toolpathBounds3: bounds,
    workOffset: { x: 6.48, y: 416.49, z: -17 },
    travel,
  };
  const check = (input: Partial<typeof base>) => getJobChecklist({ ...base, ...input }).find(i => i.id === 'travel')!;

  it('asks for the zero, and still blocks, when only the old zero is out of the travel', () => {
    const item = check({});
    expect(item.zeroFirst).toBe(true);
    expect(item.blocking).toBe(true);
    expect(item.label).toMatch(/^Set the zero first/);
    expect(item.details).toBeUndefined();
  });

  it('reports a job that does not fit where it is placed, with the numbers', () => {
    const item = check({ toolpathOffset: { x: 14.3, y: 300 } });
    expect(item.zeroFirst).toBeUndefined();
    expect(item.blocking).toBe(true);
    expect(item.details).toEqual([
      'Y would go to 1281.71, 40.71 mm above the Y travel 3 to 1241. Move the Y zero at least 40.71 mm down, or the job is too large.',
    ]);
  });

  it('holds Z against an old zero only until Z is zeroed', () => {
    const placed = { machineZero: { x: 14.3, y: 118.7 }, workOffset: { x: 14.3, y: 118.7, z: -17 } };
    expect(check(placed).zeroFirst).toBe(true);
    const zeroed = check({ ...placed, zZeroed: true });
    expect(zeroed.zeroFirst).toBeUndefined();
    expect(zeroed.details?.[0]).toMatch(/^Z would go to 8.8, 5.8 mm above/);
  });

  it('reports the Z problem itself for G-code that sets Z, which has no zero step left', () => {
    const placed = { machineZero: { x: 14.3, y: 118.7 }, workOffset: { x: 14.3, y: 118.7, z: -17 } };
    const item = check({ ...placed, gcode: 'G38.2 Z-20 F100\nG1 X10' });
    expect(item.zeroFirst).toBeUndefined();
    expect(item.blocking).toBe(true);
    expect(item.details?.[0]).toMatch(/^Z would go to 8.8/);
  });

  it('passes from the zero on the controller, set or not', () => {
    expect(check({ workOffset: { x: 14.3, y: 118.7, z: -60 } }).ok).toBe(true);
    expect(check({ machineZero: { x: 14.3, y: 118.7 }, workOffset: { x: 14.3, y: 118.7, z: -60 }, zZeroed: true }).ok).toBe(true);
  });
});

describe('zeroGhost', () => {
  const travel = {
    x: { min: 3, max: 621, softLimits: true },
    y: { min: 3, max: 1241, softLimits: true },
    z: { min: -97, max: 3, softLimits: true },
  };
  const toolpathBounds = { min: { x: 0, y: 0 }, max: { x: 572.71, y: 981.71 } };
  const toolpathOffset = { x: 14.3, y: 118.7 };

  it('shows nothing once the zero is where the job is placed', () => {
    expect(zeroGhost({ toolpathBounds, workOffset: toolpathOffset, toolpathOffset, travel })).toBeNull();
  });

  it('outlines where the job would run from an old zero, and what lies past the travel', () => {
    const ghost = zeroGhost({ toolpathBounds, workOffset: { x: 6.48, y: 416.49 }, toolpathOffset, travel })!;
    expect(ghost.max.y).toBeCloseTo(1398.2);
    expect(ghost.past).toHaveLength(1);
    expect(ghost.past[0]!.min.y).toBe(1241);
    expect(ghost.past[0]!.max.y).toBeCloseTo(1398.2);
    expect(ghost.past[0]!.min.x).toBe(ghost.min.x);
    expect(ghost.label).toBe('Would run here from the current zero: 157.2 mm past the Y limit');
  });

  it('marks only the outline itself when all of it is past the travel', () => {
    const ghost = zeroGhost({ toolpathBounds, workOffset: { x: 6, y: 1500 }, toolpathOffset, travel })!;
    expect(ghost.past[0]!.min.y).toBe(ghost.min.y);
    expect(ghost.past[0]!.max.y).toBe(ghost.max.y);
  });

  it('has nothing to outline for a program without moves', () => {
    const empty = { min: { x: Infinity, y: Infinity }, max: { x: -Infinity, y: -Infinity } };
    expect(zeroGhost({ toolpathBounds: empty, workOffset: { x: 6, y: 416 }, toolpathOffset, travel })).toBeNull();
  });

  it('still outlines it when it stays inside the travel, or the travel is unknown', () => {
    const inside = zeroGhost({ toolpathBounds, workOffset: { x: 20, y: 100 }, toolpathOffset, travel })!;
    expect(inside.past).toEqual([]);
    expect(inside.label).toBe('Would run here from the current zero');
    expect(zeroGhost({ toolpathBounds, workOffset: { x: 6, y: 416 }, toolpathOffset, travel: null })!.past).toEqual([]);
  });
});

describe('checkPosition', () => {
  // The LowRider's X homes to mpos_mm 3, its travel minimum: FluidNC 3.9.1 left it at 2.99 and every job then stopped
  // with "Soft limit on X target:2.990" on its first move, a Z lift.
  const travel = {
    x: { min: 3, max: 1223, softLimits: true },
    y: { min: 3, max: 2443, softLimits: true },
    z: { min: -297, max: 3, softLimits: false },
  };

  it('blocks a run while an axis with soft limits sits outside the travel', () => {
    const item = checkPosition({ x: 2.99, y: 120, z: -10 }, travel);
    expect(item.ok).toBe(false);
    expect(item.blocking).toBe(true);
    expect(item.details).toEqual(['X is at 2.99, 0.01 mm below the X travel 3 to 1223. Move X into the travel first.']);
  });

  it('jogs each axis half a millimetre past the limit it is outside of', () => {
    const out = outsideTravel({ x: 2.99, y: 120, z: 3.2 }, travel);
    expect(out.map(o => [o.axis, Number(o.jog.toFixed(3))])).toEqual([
      ['x', 0.51],
      ['z', -0.7],
    ]);
  });

  it('only warns without soft limits, and passes inside the travel', () => {
    expect(checkPosition({ x: 100, y: 100, z: 3.2 }, travel).blocking).toBe(false);
    expect(checkPosition({ x: 3, y: 3, z: 3 }, travel).ok).toBe(true);
  });

  it('is part of the pre-job checklist only when it fails', () => {
    const base = { gcode: 'G1 X10', homed: true, zZeroed: true, toolpathOffset: { x: 0, y: 0 }, machineZero: { x: 0, y: 0 }, travel };
    expect(getJobChecklist({ ...base, machinePosition: { x: 3, y: 3, z: 0 } }).some(i => i.id === 'position')).toBe(false);
    expect(getJobChecklist({ ...base, machinePosition: { x: 2.99, y: 3, z: 0 } }).find(i => i.id === 'position')?.blocking).toBe(true);
  });
});
