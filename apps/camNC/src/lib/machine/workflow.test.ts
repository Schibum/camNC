import { describe, expect, it } from 'vitest';
import { checkTravel, g53Targets, getJobChecklist, machineView } from './workflow';

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
