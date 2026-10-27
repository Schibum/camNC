import { hasProbeOrZeroCommand } from '@/visualize/gcodeChecks';
import type { MachineTravel, Position } from '@wbcnc/fluidnc';

/** Which part of the machine panel fits the current situation. */
export type MachineView = 'setup' | 'running';

const kRunningStates = new Set(['Run', 'Hold', 'Door']);

export function machineView({ state, jobActive }: { state: string | null; jobActive: boolean }): MachineView {
  return jobActive || (state !== null && kRunningStates.has(state)) ? 'running' : 'setup';
}

export interface ChecklistItem {
  id: 'homed' | 'bounds' | 'travel' | 'xy-zero' | 'z-zero' | 'tool-change';
  ok: boolean;
  label: string;
  /** Per-axis details, e.g. for the travel check. */
  details?: string[];
  /** The job cannot run like this (the controller would stop it with an alarm). */
  blocking?: boolean;
}

interface Box3Like {
  min: { x: number; y: number; z: number };
  max: { x: number; y: number; z: number };
}

const fmt = (n: number) => n.toFixed(2).replace(/\.?0+$/, '');
/** Travel limits are compared with this tolerance (mm). */
const kTravelEpsilon = 0.001;

/** Machine-coordinate targets of `G53` moves, per axis (`G53` words are not offset by the work zero). */
export function g53Targets(gcode: string): { axis: 'x' | 'y' | 'z'; value: number }[] {
  const out: { axis: 'x' | 'y' | 'z'; value: number }[] = [];
  for (const raw of gcode.split('\n')) {
    const line = raw.replace(/\(.*?\)|;.*$/g, '').toUpperCase();
    if (!/\bG53\b/.test(line)) continue;
    for (const match of line.matchAll(/([XYZ])\s*(-?\d*\.?\d+)/g)) {
      out.push({ axis: match[1]!.toLowerCase() as 'x' | 'y' | 'z', value: Number(match[2]) });
    }
  }
  return out;
}

/**
 * Whether the job stays within the machine travel: the toolpath's work-coordinate bounds plus the work offset, and
 * `G53` targets as they are. A violation blocks the run if the controller enforces soft limits on that axis (it
 * would stop the job with ALARM:2); without soft limits it only warns.
 */
export function checkTravel(input: {
  toolpathBounds: Box3Like;
  workOffset: Position;
  travel: MachineTravel;
  gcode: string;
}): ChecklistItem {
  const { toolpathBounds, workOffset, travel, gcode } = input;
  const details: string[] = [];
  let blocking = false;
  const g53 = g53Targets(gcode);
  for (const axis of ['x', 'y', 'z'] as const) {
    const limits = travel[axis];
    if (!limits) continue;
    const name = axis.toUpperCase();
    // G53 moves are in machine coordinates already; the rest of the toolpath is offset by the work zero.
    const low = toolpathBounds.min[axis] + workOffset[axis];
    const high = toolpathBounds.max[axis] + workOffset[axis];
    const extremes = [low, high, ...g53.filter(t => t.axis === axis).map(t => t.value)];
    const min = Math.min(...extremes);
    const max = Math.max(...extremes);
    const range = `${fmt(limits.min)} to ${fmt(limits.max)}`;
    if (min < limits.min - kTravelEpsilon) {
      const by = limits.min - min;
      details.push(
        `${name} would go to ${fmt(min)}, ${fmt(by)} mm below the ${name} travel ${range}. ` +
          (axis === 'z'
            ? 'The Z zero is too low, or the job cuts too deep.'
            : `Move the ${name} zero at least ${fmt(by)} mm up, or the job is too large.`)
      );
      blocking ||= limits.softLimits;
    }
    if (max > limits.max + kTravelEpsilon) {
      const by = max - limits.max;
      details.push(
        `${name} would go to ${fmt(max)}, ${fmt(by)} mm above the ${name} travel ${range}. ` +
          (axis === 'z'
            ? 'The Z zero is too high, or the safe height is too large.'
            : `Move the ${name} zero at least ${fmt(by)} mm down, or the job is too large.`)
      );
      blocking ||= limits.softLimits;
    }
  }
  if (!details.length) return { id: 'travel', ok: true, label: 'Within the machine travel' };
  return {
    id: 'travel',
    ok: false,
    blocking,
    label: blocking
      ? 'Leaves the machine travel: the controller would stop with a soft limit alarm'
      : 'Leaves the machine travel (soft limits are off)',
    details,
  };
}

interface Rect {
  min: { x: number; y: number };
  max: { x: number; y: number };
}

export interface ChecklistInput {
  gcode: string;
  homed: boolean;
  zZeroed: boolean;
  /** Toolpath bounds in work coordinates */
  toolpathBounds?: Rect;
  /** Where the toolpath is placed on the camera view (machine coordinates of its origin) */
  toolpathOffset: { x: number; y: number };
  /** Work zero of the active WCS on the controller (machine coordinates) */
  machineZero: { x: number; y: number } | null;
  machineBounds?: Rect;
  /** Toolpath bounds in work coordinates, with Z, for the travel check. */
  toolpathBounds3?: Box3Like;
  /** Current work offset (WCO) in machine coordinates. */
  workOffset?: Position | null;
  /** Machine travel from the controller, when known. */
  travel?: MachineTravel | null;
}

/** Pre-job checks. Failed items are shown as warnings; only `blocking` ones prevent the run. */
export function getJobChecklist(input: ChecklistInput): ChecklistItem[] {
  const { gcode, toolpathBounds, toolpathOffset, machineZero, machineBounds } = input;
  const items: ChecklistItem[] = [];
  items.push({ id: 'homed', ok: input.homed, label: input.homed ? 'Homed' : 'Not homed since connecting' });

  if (toolpathBounds && machineBounds) {
    const inside =
      toolpathBounds.min.x + toolpathOffset.x >= machineBounds.min.x &&
      toolpathBounds.min.y + toolpathOffset.y >= machineBounds.min.y &&
      toolpathBounds.max.x + toolpathOffset.x <= machineBounds.max.x &&
      toolpathBounds.max.y + toolpathOffset.y <= machineBounds.max.y;
    items.push({ id: 'bounds', ok: inside, label: inside ? 'Inside machine bounds' : 'Toolpath extends outside the machine bounds' });
  }

  if (input.toolpathBounds3 && input.workOffset && input.travel) {
    items.push(checkTravel({ toolpathBounds: input.toolpathBounds3, workOffset: input.workOffset, travel: input.travel, gcode }));
  }

  const zeroMatches =
    !!machineZero && Math.abs(machineZero.x - toolpathOffset.x) < 0.01 && Math.abs(machineZero.y - toolpathOffset.y) < 0.01;
  items.push({
    id: 'xy-zero',
    ok: zeroMatches,
    label: zeroMatches ? 'XY zero matches the toolpath' : 'Machine XY zero differs from the toolpath position',
  });

  const probes = hasProbeOrZeroCommand(gcode);
  items.push({
    id: 'z-zero',
    ok: input.zZeroed || probes,
    label: probes ? 'G-code sets Z itself' : input.zZeroed ? 'Z zeroed' : 'Z not probed or zeroed since connecting',
  });

  if (/\bM0?6\b/i.test(gcode)) {
    items.push({ id: 'tool-change', ok: false, label: 'Contains tool changes (M6): the job pauses there' });
  }
  return items;
}
