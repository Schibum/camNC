import { getCncApi } from '@/lib/fluidnc/machine';
import { useStore, getMachineBounds } from '@/store/store';
import { toast } from '@wbcnc/ui/components/sonner';
import { useEffect } from 'react';
import { JobRecord, saveJobRecord } from './jobRecord';
import { applyRecord, InterruptedJob, interruptedJob, noteJobStopRequested } from './jobRecovery';
import type { Macro } from './macros';
import { buildResumeProgram, parseProgram, programBounds } from './resume';
import { checkTravel, getJobChecklist } from './workflow';

export function errorText(err: unknown) {
  return err instanceof Error ? err.message : String(err);
}

/** Name of the file camNC uploads to the SD card for the current toolpath. */
export const kJobFileName = 'camnc.gcode';
/** Name of the file for resuming an interrupted job (the original stays on the SD card). */
export const kResumeFileName = 'camnc-resume.gcode';

/** Whether an SD file (`/sd/camnc.gcode`) is one camNC uploaded for the loaded toolpath. */
export function isCamncJobFile(file: string) {
  return [kJobFileName, kResumeFileName].some(name => file === name || file.endsWith(`/${name}`));
}

/** Feed hold first so the position is kept, then reset to flush the planner. */
export async function stopJob() {
  const api = getCncApi();
  noteJobStopRequested();
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

const kUploadToast = 'upload-gcode';

async function step<T>(promise: Promise<T>, loading: string, success: string) {
  toast.promise(promise, { id: kUploadToast, loading, success, error: err => `${loading.replace('…', '')} failed: ${errorText(err)}` });
  return promise;
}

/** Remember the job just started, so that a reload can show it again (jobRecovery.ts) and it can be resumed (resume.ts). */
function recordJob(fields: Pick<JobRecord, 'gcode' | 'sdFile' | 'toolpathName'>) {
  const api = getCncApi();
  const { toolpathOffset, stockHeight, toolDiameter } = useStore.getState();
  const wco = api.status.value?.wco;
  const host = api.host.value;
  if (!host || !wco) return;
  void saveJobRecord({
    host,
    ...fields,
    toolpathOffset: { x: toolpathOffset.x, y: toolpathOffset.y, z: toolpathOffset.z },
    stockHeight,
    toolDiameter,
    wco,
    startedAt: api.jobStartedAt.value ?? Date.now(),
    homed: api.homed.value,
    zZeroedAt: api.zZeroedAt.value,
  }).catch(() => {});
}

/** Upload the current G-code and run it. Zeroing is a separate step (see the checklist). */
export async function uploadAndRun() {
  const api = getCncApi();
  const { toolpath, toolpathName } = useStore.getState();
  if (!toolpath?.gcode) throw new Error('No toolpath loaded');
  await step(api.uploadGcode(toolpath.gcode, kJobFileName), 'Uploading…', 'Uploaded and verified');
  await step(api.runFile(kJobFileName), 'Starting job…', 'Job started');
  recordJob({ gcode: toolpath.gcode, sdFile: kJobFileName, toolpathName });
}

/** Machine Z to retract to before moving over the restart point: just below the top of the Z travel. */
export function resumeSafeZ() {
  const api = getCncApi();
  const z = api.travel.value?.z;
  return z ? z.max - 1 : (api.status.value?.mpos.z ?? null);
}

/** The program that resumes `job` at `line` (0-based), checked against the machine travel. */
export function prepareResume(job: InterruptedJob, line: number) {
  const api = getCncApi();
  const safeZMachine = resumeSafeZ();
  if (safeZMachine === null) throw new Error('The machine position is not known yet');
  const resume = buildResumeProgram(parseProgram(job.record.gcode), { line, safeZMachine, name: job.record.toolpathName ?? undefined });
  const travel = api.travel.value;
  const wco = api.status.value?.wco;
  const check =
    travel && wco
      ? checkTravel({ toolpathBounds: programBounds(parseProgram(resume.gcode)), workOffset: wco, travel, gcode: resume.gcode })
      : null;
  return { ...resume, travel: check };
}

/** Upload and run the program that resumes an interrupted job, and show it as the loaded toolpath. */
export async function runResume(job: InterruptedJob, line: number) {
  const api = getCncApi();
  const resume = prepareResume(job, line);
  if (resume.travel?.blocking) throw new Error(resume.travel.details?.join(' ') ?? resume.travel.label);
  const name = `${job.record.toolpathName ?? 'Job'} (from line ${line + 1})`;
  // Show what runs now, placed like the original.
  applyRecord(api, { ...job.record, gcode: resume.gcode, toolpathName: name }, { machineState: false });
  await step(api.uploadGcode(resume.gcode, kResumeFileName), 'Uploading…', 'Uploaded and verified');
  await step(api.runFile(kResumeFileName), 'Starting job…', 'Job resumed: Resume once the bit is clear');
  interruptedJob.value = null;
  recordJob({ gcode: resume.gcode, sdFile: kResumeFileName, toolpathName: name });
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
    machineBounds: getMachineBounds() ?? undefined,
    toolpathBounds3: { min: bounds.min, max: bounds.max },
    workOffset,
    travel,
  });
}
