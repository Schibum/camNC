import { hasProbeOrZeroCommand } from '@/visualize/gcodeChecks';

/** Which part of the machine panel fits the current situation. */
export type MachineView = 'setup' | 'running';

const kRunningStates = new Set(['Run', 'Hold', 'Door']);

export function machineView({ state, jobActive }: { state: string | null; jobActive: boolean }): MachineView {
  return jobActive || (state !== null && kRunningStates.has(state)) ? 'running' : 'setup';
}

export interface ChecklistItem {
  id: 'homed' | 'bounds' | 'xy-zero' | 'z-zero' | 'tool-change';
  ok: boolean;
  label: string;
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
}

/** Pre-job checks. None of them blocks the run; failed items are shown as warnings. */
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
