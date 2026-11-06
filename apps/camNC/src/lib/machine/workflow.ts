import { hasProbeOrZeroCommand } from '@/visualize/gcodeChecks';
import type { MachineTravel, Position } from '@wbcnc/fluidnc';

/** Which part of the machine panel fits the current situation. */
export type MachineView = 'setup' | 'running';

const kRunningStates = new Set(['Run', 'Hold', 'Door']);

export function machineView({ state, jobActive }: { state: string | null; jobActive: boolean }): MachineView {
  return jobActive || (state !== null && kRunningStates.has(state)) ? 'running' : 'setup';
}

export interface ChecklistItem {
  id: 'homed' | 'bounds' | 'travel' | 'position' | 'xy-zero' | 'z-zero' | 'tool-change';
  ok: boolean;
  label: string;
  /** Per-axis details, e.g. for the travel check. */
  details?: string[];
  /** The job cannot run like this (the controller would stop it with an alarm). */
  blocking?: boolean;
  /** The problem is the zero still on the controller: it goes away with the open zero steps. */
  zeroFirst?: boolean;
}

interface Box3Like {
  min: { x: number; y: number; z: number };
  max: { x: number; y: number; z: number };
}

const fmt = (n: number) => n.toFixed(2).replace(/\.?0+$/, '');
/** Travel limits are compared with this tolerance (mm). */
const kTravelEpsilon = 0.001;

/** Machine-coordinate targets of `G53` moves, per axis (`G53` words are not offset by the work zero). */
/**
 * Not a block: camNC may have connected after the machine was homed, and only the controller knows. On an unhomed
 * machine the closing `G53` lift goes to a Z that means nothing.
 */
export const kHomeFirst =
  'Not homed since camNC connected: this program parks Z in machine coordinates (G53), so home first unless the machine was homed before.';

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

/**
 * {@link checkTravel} for a job whose zero steps may still be open. A run starts from the zero on the controller, so
 * that decides whether it can start. But an old zero says nothing about the job: judge it by where it is placed (XY,
 * and Z only once zeroed), and report a problem that the zero steps will solve as just that.
 */
function checkJobTravel(input: {
  toolpathBounds: Box3Like;
  workOffset: Position;
  travel: MachineTravel;
  gcode: string;
  toolpathOffset: { x: number; y: number };
  xyPending: boolean;
  zPending: boolean;
}): ChecklistItem {
  const { toolpathOffset, xyPending, zPending, ...current } = input;
  const now = checkTravel(current);
  if (now.ok || (!xyPending && !zPending)) return now;
  const placed = checkTravel({
    ...current,
    workOffset: xyPending ? { ...current.workOffset, x: toolpathOffset.x, y: toolpathOffset.y } : current.workOffset,
    travel: zPending ? { ...current.travel, z: null } : current.travel,
  });
  if (placed.blocking) return placed;
  return {
    id: 'travel',
    ok: false,
    blocking: now.blocking,
    zeroFirst: true,
    label: 'Set the zero first: the old zero would leave the machine travel',
  };
}

/** An axis the machine already sits outside of, and the jog (mm, relative) that brings it back inside. */
export interface OutsideTravel {
  axis: 'x' | 'y' | 'z';
  at: number;
  min: number;
  max: number;
  softLimits: boolean;
  /** Relative jog into the travel: half a millimetre past the limit. */
  jog: number;
}

/** How far into the travel {@link outsideTravel} jogs an axis back. */
export const kIntoTravel = 0.5;

/**
 * Axes whose machine position is outside the travel. FluidNC 3.9 checks the soft limits of every axis on every move,
 * named in the line or not: with X one step below its minimum (as it can end after homing), even `G0 Z5` stops with
 * "Soft limit on X target:2.990". FluidNC 4 tolerates one step.
 */
export function outsideTravel(mpos: Position, travel: MachineTravel): OutsideTravel[] {
  const out: OutsideTravel[] = [];
  for (const axis of ['x', 'y', 'z'] as const) {
    const limits = travel[axis];
    if (!limits) continue;
    const at = mpos[axis];
    if (at < limits.min - kTravelEpsilon) out.push({ axis, at, ...limits, jog: limits.min - at + kIntoTravel });
    else if (at > limits.max + kTravelEpsilon) out.push({ axis, at, ...limits, jog: limits.max - at - kIntoTravel });
  }
  return out;
}

/** Whether the machine can start a move from where it is: see {@link outsideTravel}. */
export function checkPosition(mpos: Position, travel: MachineTravel): ChecklistItem {
  const outside = outsideTravel(mpos, travel);
  if (!outside.length) return { id: 'position', ok: true, label: 'The machine is within its travel' };
  const blocking = outside.some(o => o.softLimits);
  return {
    id: 'position',
    ok: false,
    blocking,
    label: blocking
      ? 'The machine sits outside its travel: the controller would stop the first move, even a Z lift, with a soft limit alarm'
      : 'The machine sits outside its travel (soft limits are off)',
    details: outside.map(o => {
      const name = o.axis.toUpperCase();
      const side = o.at < o.min ? `${fmt(o.min - o.at)} mm below` : `${fmt(o.at - o.max)} mm above`;
      return `${name} is at ${fmt(o.at)}, ${side} the ${name} travel ${fmt(o.min)} to ${fmt(o.max)}. Move ${name} into the travel first.`;
    }),
  };
}

export interface ZeroGhost {
  min: { x: number; y: number };
  max: { x: number; y: number };
  /** The parts of the outline past the machine travel. */
  past: { min: { x: number; y: number }; max: { x: number; y: number } }[];
  label: string;
}

/**
 * Where a program would really run from the zero on the controller, while that isn't where it is placed. The outline
 * in the view tells at a glance what numbers about an old zero don't.
 */
export function zeroGhost(input: {
  toolpathBounds: { min: { x: number; y: number }; max: { x: number; y: number } };
  workOffset: { x: number; y: number };
  toolpathOffset: { x: number; y: number };
  travel?: MachineTravel | null;
}): ZeroGhost | null {
  const { toolpathBounds: b, workOffset: w, toolpathOffset: placed, travel } = input;
  if (Math.abs(w.x - placed.x) < 0.01 && Math.abs(w.y - placed.y) < 0.01) return null;
  // A program without moves has empty bounds: nothing to outline.
  if (![b.min.x, b.min.y, b.max.x, b.max.y].every(Number.isFinite)) return null;
  const min = { x: b.min.x + w.x, y: b.min.y + w.y };
  const max = { x: b.max.x + w.x, y: b.max.y + w.y };
  const past: ZeroGhost['past'] = [];
  const over: string[] = [];
  for (const axis of ['x', 'y'] as const) {
    const limits = travel?.[axis];
    if (!limits) continue;
    if (min[axis] < limits.min - kTravelEpsilon) {
      past.push({ min, max: { ...max, [axis]: Math.min(max[axis], limits.min) } });
      over.push(`${fmt(limits.min - min[axis])} mm past the ${axis.toUpperCase()} limit`);
    }
    if (max[axis] > limits.max + kTravelEpsilon) {
      past.push({ min: { ...min, [axis]: Math.max(min[axis], limits.max) }, max });
      over.push(`${fmt(max[axis] - limits.max)} mm past the ${axis.toUpperCase()} limit`);
    }
  }
  return { min, max, past, label: ['Would run here from the current zero', ...over].join(': ').replace(/limit: /g, 'limit, ') };
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
  /** Current machine position, when known. */
  machinePosition?: Position | null;
}

/** Pre-job checks. Failed items are shown as warnings; only `blocking` ones prevent the run. */
export function getJobChecklist(input: ChecklistInput): ChecklistItem[] {
  const { gcode, toolpathBounds, toolpathOffset, machineZero, machineBounds } = input;
  const items: ChecklistItem[] = [];
  const needsHoming = !input.homed && g53Targets(gcode).length > 0;
  items.push({
    id: 'homed',
    ok: input.homed,
    label: input.homed ? 'Homed' : needsHoming ? kHomeFirst : 'Not homed since connecting',
  });

  if (toolpathBounds && machineBounds) {
    const inside =
      toolpathBounds.min.x + toolpathOffset.x >= machineBounds.min.x &&
      toolpathBounds.min.y + toolpathOffset.y >= machineBounds.min.y &&
      toolpathBounds.max.x + toolpathOffset.x <= machineBounds.max.x &&
      toolpathBounds.max.y + toolpathOffset.y <= machineBounds.max.y;
    items.push({ id: 'bounds', ok: inside, label: inside ? 'Inside machine bounds' : 'Toolpath extends outside the machine bounds' });
  }

  const zeroMatches =
    !!machineZero && Math.abs(machineZero.x - toolpathOffset.x) < 0.01 && Math.abs(machineZero.y - toolpathOffset.y) < 0.01;

  if (input.toolpathBounds3 && input.workOffset && input.travel) {
    items.push(
      checkJobTravel({
        toolpathBounds: input.toolpathBounds3,
        workOffset: input.workOffset,
        travel: input.travel,
        gcode,
        toolpathOffset,
        xyPending: !zeroMatches,
        // G-code that sets Z itself has no zero step left to do: the Z offset it starts from is what counts.
        zPending: !input.zZeroed && !hasProbeOrZeroCommand(gcode),
      })
    );
  }
  if (input.machinePosition && input.travel) {
    const position = checkPosition(input.machinePosition, input.travel);
    if (!position.ok) items.push(position);
  }

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
