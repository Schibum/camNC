import { getCncApi } from '@/lib/fluidnc/machine';
import { getActiveCamSource, useStore } from '@/store/store';
import { toast } from '@wbcnc/ui/components/sonner';
import { useEffect } from 'react';
import { saveJobRecord } from './jobRecord';
import type { Macro } from './macros';
import { getJobChecklist } from './workflow';

export function errorText(err: unknown) {
  return err instanceof Error ? err.message : String(err);
}

/** Name of the file camNC uploads to the SD card for the current toolpath. */
export const kJobFileName = 'camnc.gcode';

/** Feed hold first so the position is kept, then reset to flush the planner. */
export async function stopJob() {
  const api = getCncApi();
  api.feedHold();
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline && !(api.state.value === 'Hold' && api.status.value?.subState === 0)) {
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  api.softReset();
}

/** Set the machine's work XY zero to where the toolpath is placed on the camera view. */
export function setXYZeroFromToolpath(move = false) {
  const api = getCncApi();
  const { x, y } = useStore.getState().toolpathOffset;
  const promise = move ? api.setWorkspaceXYZeroAndMove(x, y) : api.setWorkspaceXYZero(x, y);
  toast.promise(promise, {
    loading: 'Setting XY zero…',
    success: `XY zero set to ${x.toFixed(2)}, ${y.toFixed(2)}`,
    error: err => `Setting XY zero failed: ${errorText(err)}`,
  });
  return promise.catch(() => {});
}

/** Upload the current G-code and run it. Zeroing is a separate step (see the checklist). */
export async function uploadAndRun() {
  const api = getCncApi();
  const { toolpath } = useStore.getState();
  if (!toolpath?.gcode) throw new Error('No toolpath loaded');
  const toastId = 'upload-gcode';
  const step = async <T>(promise: Promise<T>, loading: string, success: string) => {
    toast.promise(promise, { id: toastId, loading, success, error: err => `${loading.replace('…', '')} failed: ${errorText(err)}` });
    return promise;
  };
  await step(api.uploadGcode(toolpath.gcode, kJobFileName), 'Uploading…', 'Uploaded and verified');
  await step(api.runFile(kJobFileName), 'Starting job…', 'Job started');
  // So that a reload during the job can show it again (see jobRecovery.ts).
  const { toolpathName, toolpathOffset, stockHeight, toolDiameter } = useStore.getState();
  const wco = api.status.value?.wco;
  const host = api.host.value;
  if (host && wco) {
    void saveJobRecord({
      host,
      sdFile: kJobFileName,
      gcode: toolpath.gcode,
      toolpathName,
      toolpathOffset: { x: toolpathOffset.x, y: toolpathOffset.y, z: toolpathOffset.z },
      stockHeight,
      toolDiameter,
      wco,
      startedAt: api.jobStartedAt.value ?? Date.now(),
      homed: api.homed.value,
      zZeroedAt: api.zZeroedAt.value,
    }).catch(() => {});
  }
}

export async function runMacro(macro: Macro) {
  const promise = getCncApi().runMacro(macro);
  toast.promise(promise, {
    loading: `Running ${macro.name}…`,
    success: `${macro.name} done`,
    error: err => `${macro.name}: ${errorText(err)}`,
  });
  return promise.catch(() => {});
}

/** Pre-job checklist for the loaded toolpath, live from the store and the machine signals. */
export function useJobChecklist() {
  'use no memo';
  const api = getCncApi();
  const toolpath = useStore(s => s.toolpath);
  const offset = useStore(s => s.toolpathOffset);
  const homed = api.homed.value;
  const zZeroed = api.zZeroedAt.value !== null;
  const machineZero = api.currentZero.value;
  const workOffset = api.status.value?.wco ?? null;
  const travel = api.travel.value;
  const idle = api.isConnected.value && api.state.value === 'Idle';
  // Read the travel once per connection, while idle.
  useEffect(() => {
    if (toolpath && idle) api.ensureTravel();
  }, [api, toolpath, idle]);
  if (!toolpath) return [];
  const bounds = toolpath.getBounds();
  return getJobChecklist({
    gcode: toolpath.gcode,
    homed,
    zZeroed,
    toolpathBounds: { min: bounds.min, max: bounds.max },
    toolpathOffset: offset,
    machineZero,
    machineBounds: getActiveCamSource()?.machineBounds,
    toolpathBounds3: { min: bounds.min, max: bounds.max },
    workOffset,
    travel,
  });
}
