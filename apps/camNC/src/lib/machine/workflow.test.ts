import { describe, expect, it } from 'vitest';
import { getJobChecklist, machineView } from './workflow';

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
