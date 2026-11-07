import { effect, signal } from '@preact/signals-react';
import { toast } from '@wbcnc/ui/components/sonner';
import { cleanupRetiredExecutionFiles, retireExecutionFiles } from './executionFiles';
import { Vector3 } from 'three';
import { getExistingCncApi } from '../fluidnc/machine';
import { isDemoMode } from '../demo/demo-mode';
import { recordNativeRun } from '@/cam/machine/nativeRunHistory';
import { matchesResumableSetup, captureManufacturingSnapshot } from '@/cam/machine/manufacturingSnapshot';
import { useCamMachine } from '@/cam/machine/camMachine';
import { useStore } from '../../store/store';
import type { CncApi } from '../fluidnc/cnc-api';
import type { MachineStatus } from '@wbcnc/fluidnc';
import { rememberExecutionProgram } from './executionProgram';
import { executionReference, sameExecutionReference, type ExecutionReference } from './executionOwnership';
import {
  compareAndSaveJobRecord,
  type JobProgressLog,
  jobEnding,
  type JobRecord,
  loadJobProgress,
  loadJobRecord,
  recoveryAction,
  sameJobExecution,
  readJobRecordHead,
  saveJobRecordAtHead,
  saveJobProgressForRecord,
} from './jobRecord';

export interface InterruptedJob {
  record: JobRecord;
  progress: JobProgressLog;
  reason: string;
}
export const interruptedJob = signal<InterruptedJob | null>(null);
/** Durable setup discovery precedes queue replacement, including while the socket connects. */
export const recoveryPending = signal(false);
export const runningJobName = signal<string | null>(null);

export function dismissInterruptedJob() {
  const job = interruptedJob.value;
  interruptedJob.value = null;
  if (
    useCamMachine.getState().runReview &&
    job?.record.camSnapshot &&
    matchesResumableSetup(useCamMachine.getState(), job.record.camSnapshot)
  )
    useCamMachine.setState({ runReview: 'stopped' });
  if (job) {
    const demo = isDemoMode();
    void compareAndSaveJobRecord(job.record, null, demo)
      .then(removed => {
        if (removed) retireExecutionFiles(job.record.host, [job.record.sdFile], demo);
        const api = getExistingCncApi();
        if (api) return cleanupRetiredExecutionFiles(api, { demo });
      })
      .catch(() => {});
  }
}

/** Receipt cleanup is conditional; an older completion must never remove a newer execution or its SD object. */
async function discardReceipt(record: JobRecord, demo: boolean) {
  if (!(await compareAndSaveJobRecord(record, null, demo))) return false;
  retireExecutionFiles(record.host, [record.sdFile], demo);
  if (!record.camSnapshot && ownsReceipt(record) && !useCamMachine.getState().preparingRun) useCamMachine.setState({ runRecord: null });
  const api = getExistingCncApi();
  if (api) await cleanupRetiredExecutionFiles(api, { demo }).catch(() => {});
  return true;
}

const kProgressInterval = 2000;
let stopRequested = false;
export function noteJobStopRequested() {
  stopRequested = true;
}
const atRest = (status: MachineStatus | null) => !!status && !status.job && !['Run', 'Hold', 'Door'].includes(status.state);
const sameWco = (a: JobRecord['wco'], b: JobRecord['wco']) =>
  Math.abs(a.x - b.x) <= 0.01 && Math.abs(a.y - b.y) <= 0.01 && Math.abs(a.z - b.z) <= 0.01;
function ownsReceipt(receipt: ExecutionReference) {
  return sameExecutionReference(useCamMachine.getState().runRecord, receipt);
}
function mayRestore(record: JobRecord) {
  const state = useCamMachine.getState();
  if (state.preparingExecutionId && state.preparingExecutionId !== record.executionId) return false;
  const protectedNative = !!state.runSnapshot && !!state.runReview;
  return !protectedNative || !state.runRecord || sameExecutionReference(state.runRecord, record);
}

/** Re-check both the durable head and latest controller status after every asynchronous lookup. */
async function offerResume(
  api: CncApi,
  expected: JobRecord,
  reason: string,
  progress: JobProgressLog | undefined,
  demo: boolean,
  valid: () => boolean
) {
  const [record, saved] = await Promise.all([
    loadJobRecord(expected.host, demo),
    progress ? Promise.resolve(progress) : loadJobProgress(expected.host, demo),
  ]);
  if (
    !valid() ||
    isDemoMode() !== demo ||
    api.host.value !== expected.host ||
    !sameJobExecution(record, expected) ||
    !record ||
    !saved ||
    !atRest(api.status.value) ||
    record.execution === 'finished' ||
    !mayRestore(record)
  )
    return;
  if (
    !saved.file.endsWith(record.sdFile) ||
    saved.at < record.startedAt ||
    ((record.executionId || saved.executionId) && record.executionId !== saved.executionId)
  )
    return;
  if (record.camSnapshot) {
    applyRecord(api, record, { machineState: false });
    useCamMachine.setState({ runReview: 'stopped' });
  }
  interruptedJob.value = { record, progress: saved, reason };
}

/** Restore a known receipt, retaining the original full queue program when record.gcode is a resume tail. */
export function applyRecord(api: CncApi, record: JobRecord, { machineState }: { machineState: boolean }) {
  const store = useStore.getState();
  store.updateToolpath(record.gcode, record.toolpathName ?? undefined);
  store.setToolpathOffset(new Vector3(record.toolpathOffset.x, record.toolpathOffset.y, record.toolpathOffset.z));
  store.setStockHeight(record.stockHeight);
  store.setToolDiameter(record.toolDiameter);
  reserveNativeRecord(record);
  if (machineState) {
    rememberExecutionProgram(record.sdFile, record.gcode);
    runningJobName.value = record.toolpathName;
    api.jobStartedAt.value = record.startedAt;
    api.homed.value = record.homed;
    api.zZeroedAt.value = record.zZeroedAt;
  }
}

/** A stale view that encounters a foreign native receipt must expose its review instead of replacing it. */
export async function showRecordedNativeRun(api: CncApi, record: JobRecord, demo: boolean) {
  applyRecord(api, record, { machineState: false });
  if (record.execution !== 'prepared' && record.execution !== 'finished')
    await offerResume(
      api,
      record,
      'Review the original program before starting another machining setup.',
      undefined,
      demo,
      () => api.host.value === record.host && isDemoMode() === demo && atRest(api.status.value)
    );
}
function reserveNativeRecord(record: JobRecord) {
  if (!record.camSnapshot) return;
  const snapshot = captureManufacturingSnapshot(record.camSnapshot);
  useCamMachine.setState({
    jobId: snapshot.jobId,
    active: snapshot.active,
    loadedSnapshot: snapshot,
    runSnapshot: snapshot,
    overlay: snapshot.overlay,
    runReview: record.execution === 'prepared' ? 'requested' : (record.execution ?? 'requested'),
    runPreparationError:
      record.execution === 'prepared'
        ? 'This preparation did not request execution. Review the original setup; only the previous safe receipt can be resumed.'
        : null,
    runRecord: executionReference(record),
  });
}

interface ObservedRun {
  host: string;
  demo: boolean;
  reference: ExecutionReference | null;
  file: string;
  wco: JobRecord['wco'];
  firstSeen: number;
  start: number;
  percent: number;
  lastSaved: number;
  cancelled: boolean;
  record: Promise<JobRecord | null>;
}

/** Recover only from the latest controller identity; completion belongs to the receipt observed running. */
export function watchJobRecovery(api: CncApi) {
  let checkedFor: string | null = null,
    readFor: string | null = null;
  let recoveryEpoch = 0,
    reservationEpoch = 0,
    disposed = false;
  let recordRead: Promise<[JobRecord | null, JobProgressLog | null]> = Promise.resolve([null, null]);
  let reservationPending = false,
    checkPending = false,
    wasConnected = false;
  let observed: ObservedRun | null = null;
  const publishPending = () => {
    recoveryPending.value = reservationPending || checkPending;
  };
  const dispose = effect(() => {
    const host = api.host.value,
      connected = api.isConnected.value,
      status = api.status.value,
      demo = isDemoMode();
    const contextKey = `${demo ? 'demo' : 'normal'}:${host ?? ''}`;
    const setup = useCamMachine.getState();
    if (host && setup.runRecord && setup.runRecord.host !== host && !setup.preparingRun && !(setup.runSnapshot && setup.runReview))
      useCamMachine.setState({ runRecord: null });
    const valid = () => !disposed && api.host.value === host && isDemoMode() === demo;
    if (wasConnected && !connected) {
      readFor = null;
      reservationEpoch++;
      if (observed) observed.cancelled = true;
      observed = null;
    }
    wasConnected = connected;
    if (host && readFor !== contextKey) {
      readFor = contextKey;
      const epoch = ++reservationEpoch;
      reservationPending = true;
      publishPending();
      const owner = useCamMachine.getState().runRecord;
      recordRead = Promise.all([readJobRecordHead(host, demo), loadJobProgress(host, demo)])
        .then(([head, progress]) => {
          const values: [JobRecord | null, JobProgressLog | null] = [head.record, progress];
          const reservation = head.stored?.execution === 'prepared' ? head.stored : head.record;
          const current = useCamMachine.getState().runRecord;
          if (
            valid() &&
            epoch === reservationEpoch &&
            reservation?.camSnapshot &&
            mayRestore(reservation) &&
            (!owner || sameExecutionReference(current, owner))
          )
            reserveNativeRecord(reservation);
          return values;
        })
        .catch(() => [null, null] as [null, null])
        .finally(() => {
          if (epoch === reservationEpoch) {
            reservationPending = false;
            publishPending();
          }
        });
    }
    if (!connected) {
      checkedFor = null;
      recoveryEpoch++;
      checkPending = false;
      if (!host) {
        readFor = null;
        reservationEpoch++;
        reservationPending = false;
      }
      publishPending();
      return;
    }
    if (host && status?.job) {
      if (
        !observed ||
        observed.host !== host ||
        observed.demo !== demo ||
        observed.file !== status.job.file ||
        !sameWco(observed.wco, status.wco) ||
        (useCamMachine.getState().runRecord && !sameExecutionReference(observed.reference, useCamMachine.getState().runRecord))
      ) {
        if (observed) observed.cancelled = true;
        const firstSeen = Date.now(),
          expected = useCamMachine.getState().runRecord;
        const initial = status;
        const item: ObservedRun = {
          host,
          demo,
          reference: expected,
          file: status.job.file,
          wco: structuredClone(status.wco),
          firstSeen,
          start: api.jobStartedAt.value ?? firstSeen,
          percent: status.job.percent,
          lastSaved: 0,
          cancelled: false,
          record: readJobRecordHead(host, demo)
            .then(head => {
              const record = head.stored?.execution === 'prepared' ? null : head.record;
              const preparing = useCamMachine.getState();
              if (preparing.preparingRun && (!preparing.runRecord || !sameExecutionReference(preparing.runRecord, record))) return null;
              if (!record || record.startedAt > firstSeen || (expected && !sameExecutionReference(expected, record))) return null;
              const action = recoveryAction({ record, status: initial, currentGcode: null, lastAlarm: api.lastAlarm.value });
              return action.kind === 'restore' ? record : null;
            })
            .catch(() => null),
        };
        observed = item;
        stopRequested = false;
      }
      const item = observed;
      item.percent = status.job.percent;
      const now = Date.now();
      if (now - item.lastSaved >= kProgressInterval) {
        item.lastSaved = now;
        const progress = {
          host,
          file: status.job.file,
          percent: status.job.percent,
          mpos: structuredClone(status.mpos),
          wco: structuredClone(status.wco),
          at: now,
        };
        void item.record
          .then(record => {
            if (
              !record ||
              item.cancelled ||
              !valid() ||
              !mayRestore(record) ||
              (useCamMachine.getState().runRecord && !sameExecutionReference(useCamMachine.getState().runRecord, record))
            )
              return;
            const latest = api.status.value;
            if (!latest?.job || latest.job.file !== item.file || !sameWco(latest.wco, item.wco)) return;
            if (interruptedJob.value?.record.host === host) interruptedJob.value = null;
            return saveJobProgressForRecord(progress, record, demo);
          })
          .catch(() => {});
      }
    } else if (observed && host && atRest(status)) {
      const item = observed;
      observed = null;
      if (item.host !== host || item.demo !== demo) item.cancelled = true;
      const alarm = api.lastAlarm.value;
      const offsetChanged = !sameWco(item.wco, status!.wco);
      const ending = jobEnding({
        state: status!.state,
        lastPercent: item.percent,
        stopRequested,
        alarmSinceStart: offsetChanged || (!!alarm && alarm.at >= item.start),
      });
      stopRequested = false;
      void item.record
        .then(async record => {
          if (!record || item.cancelled || !valid()) return;
          if (record.camSnapshot) {
            const updated = await settleNativeRun(record, ending.finished, demo);
            if (!ending.finished && updated && valid()) await offerResume(api, updated, ending.reason, undefined, demo, valid);
          } else if (ending.finished) await discardReceipt(record, demo);
          else await offerResume(api, record, ending.reason, undefined, demo, valid);
        })
        .catch(() => {});
    }
    if (host && atRest(status)) void cleanupRetiredExecutionFiles(api, { demo, isCurrent: valid }).catch(() => {});
    if (!host || checkedFor === contextKey) return;
    checkPending = true;
    publishPending();
    if (!status) return;
    checkedFor = contextKey;
    const epoch = ++recoveryEpoch;
    const checkValid = () => valid() && api.isConnected.value && epoch === recoveryEpoch;
    void recordRead
      .then(async ([record, progress]) => {
        const latest = api.status.value;
        if (!record || !latest || !checkValid() || !mayRestore(record)) return;
        const action = recoveryAction({
          record,
          status: latest,
          currentGcode: useStore.getState().toolpath?.gcode ?? null,
          lastAlarm: api.lastAlarm.value,
          progress,
        });
        switch (action.kind) {
          case 'restore':
            applyRecord(api, record, { machineState: true });
            toast.success('Restored the running job', { description: 'Its toolpath, placement and progress are shown again.' });
            break;
          case 'ask':
            runningJobName.value = record.toolpathName;
            toast('A job camNC started is still running', {
              description: 'You have loaded a different program since. Show the running job instead?',
              duration: Infinity,
              action: {
                label: 'Show running job',
                onClick: () => {
                  const current = api.status.value;
                  if (
                    checkValid() &&
                    current &&
                    mayRestore(record) &&
                    recoveryAction({ record, status: current, currentGcode: null, lastAlarm: api.lastAlarm.value }).kind === 'restore'
                  )
                    applyRecord(api, record, { machineState: true });
                },
              },
            });
            break;
          case 'mismatch':
            runningJobName.value = null;
            toast.info('A job is running from the SD card', {
              description: `${action.reason} Its progress is shown without the toolpath.`,
            });
            break;
          case 'interrupted':
            await offerResume(
              api,
              record,
              `The job was last seen at ${action.progress.percent.toFixed(1)}% and is no longer running: the controller was power cycled or reset, or the job ended while camNC was not connected.`,
              action.progress,
              demo,
              checkValid
            );
            break;
          case 'ended':
            if (record.camSnapshot) {
              applyRecord(api, record, { machineState: false });
              break;
            }
            toast('Job finished or stopped while this page was closed', {
              duration: Infinity,
              action: {
                label: 'Load its program',
                onClick: () => {
                  if (checkValid() && atRest(api.status.value) && mayRestore(record)) {
                    applyRecord(api, record, { machineState: false });
                    void discardReceipt(record, demo);
                  }
                },
              },
              cancel: { label: 'Dismiss', onClick: () => void discardReceipt(record, demo) },
            });
            break;
        }
      })
      .catch(() => {})
      .finally(() => {
        if (valid() && epoch === recoveryEpoch) {
          checkPending = false;
          publishPending();
        }
      });
  });
  return () => {
    disposed = true;
    recoveryEpoch++;
    reservationEpoch++;
    if (observed) observed.cancelled = true;
    dispose();
    recoveryPending.value = false;
  };
}

async function settleNativeRun(record: JobRecord, finished: boolean, demo: boolean): Promise<JobRecord | null> {
  if (!record.camSnapshot) return null;
  await recordNativeRun(record.camSnapshot, finished);
  const updated = { ...record, execution: finished ? ('finished' as const) : ('stopped' as const) };
  if (!(await compareAndSaveJobRecord(record, updated, demo))) return null;
  if (ownsReceipt(record)) useCamMachine.setState({ runReview: updated.execution });
  return updated;
}

export async function acknowledgeRunReview() {
  const state = useCamMachine.getState(),
    receipt = state.runRecord,
    demo = isDemoMode(),
    api = getExistingCncApi();
  if (
    state.preparingRun ||
    recoveryPending.value ||
    api?.jobProgress.value != null ||
    api?.jobStartedAt.value != null ||
    matchesResumableSetup(state, interruptedJob.value?.record.camSnapshot)
  )
    return false;
  let previous: JobRecord | null = null;
  if (receipt && state.runReview && state.runSnapshot) {
    const head = await readJobRecordHead(receipt.host, demo);
    if (!ownsReceipt(receipt)) return false;
    previous = head.stored?.execution === 'prepared' ? head.record : null;
    if (head.stored && (!sameExecutionReference(head.stored, receipt) || !(await saveJobRecordAtHead(head, previous)))) return false;
    if (head.stored) retireExecutionFiles(receipt.host, [head.stored.sdFile], demo);
  }
  if (receipt ? !ownsReceipt(receipt) : useCamMachine.getState().runRecord !== null) return false;
  useCamMachine.setState({ runReview: null, runRecord: null, runPreparationError: null });
  if (previous && api && api.host.value === previous.host && isDemoMode() === demo) {
    const expected = previous;
    await offerResume(
      api,
      expected,
      'The previous safe program is still available after the failed preparation was closed.',
      undefined,
      demo,
      () => api.host.value === expected.host && isDemoMode() === demo && atRest(api.status.value)
    );
  }
  if (api) await cleanupRetiredExecutionFiles(api, { demo }).catch(() => {});
  return true;
}
