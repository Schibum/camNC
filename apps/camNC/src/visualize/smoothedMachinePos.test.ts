import type { MachineStatus } from '@wbcnc/fluidnc';
import { describe, expect, it } from 'vitest';
import { interpolatePosition, PositionSmoother } from './smoothedMachinePos';

const status = (state: string, x: number, y = 0, z = 0) => ({ state, mpos: { x, y, z } }) as MachineStatus;

describe('interpolatePosition', () => {
  const prev = { pos: { x: 0, y: 0, z: 0 }, at: 1000 };
  const last = { pos: { x: 10, y: 0, z: -2 }, at: 1200 };

  it('plays the last move back over one report interval and stops at the latest report', () => {
    expect(interpolatePosition(prev, last, 1200)).toEqual({ x: 0, y: 0, z: 0 });
    expect(interpolatePosition(prev, last, 1300)).toEqual({ x: 5, y: 0, z: -1 });
    expect(interpolatePosition(prev, last, 1400)).toEqual({ x: 10, y: 0, z: -2 });
    // Never beyond the latest report, however late the next one is.
    expect(interpolatePosition(prev, last, 5000)).toEqual({ x: 10, y: 0, z: -2 });
  });

  it('snaps on large jumps', () => {
    expect(interpolatePosition(prev, { pos: { x: 500, y: 0, z: 0 }, at: 1200 }, 1250)).toEqual({ x: 500, y: 0, z: 0 });
  });
});

describe('PositionSmoother', () => {
  it('animates while moving and snaps when idle', () => {
    const s = new PositionSmoother();
    s.push(status('Run', 0), 0);
    s.push(status('Run', 10), 200);
    expect(s.at(300)?.x).toBe(5);
    s.push(status('Idle', 12), 400);
    expect(s.at(400)?.x).toBe(12);
  });

  it('ignores unchanged reports and starts fresh after a disconnect or a gap', () => {
    const s = new PositionSmoother();
    s.push(status('Run', 0), 0);
    s.push(status('Run', 10), 200);
    s.push(status('Run', 10), 400);
    expect(s.at(300)?.x).toBe(5);
    s.push(null, 500);
    expect(s.at(600)).toBeNull();
    s.push(status('Run', 20), 700);
    s.push(status('Run', 30), 5000);
    expect(s.at(5000)?.x).toBe(30);
  });
});
