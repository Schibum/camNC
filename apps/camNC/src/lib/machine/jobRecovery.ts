import { effect, signal } from '@preact/signals-react';
import { toast } from '@wbcnc/ui/components/sonner';
import { Vector3 } from 'three';
import { useStore } from '../../store/store';
import type { CncApi } from '../fluidnc/cnc-api';
import {
  clearJobRecord,
  JobProgressLog,
  jobEnding,
  JobRecord,
  loadJobProgress,
  loadJobRecord,
  recoveryAction,
  saveJobProgress,
} from './jobRecord';

/** A job camNC started that stopped part way through, with where it was: the Setup view offers to resume it. */
export interface InterruptedJob {
  record: JobRecord;
  progress: JobProgressLog;
  reason: string;
}

export const interruptedJob = signal<InterruptedJob | null>(null);

/** Forget the interrupted job (the user dismissed it). */
export function dismissInterruptedJob() {
  const job = interruptedJob.value;
  interruptedJob.value = null;
  if (job) void clearJobRecord(job.record.host).catch(() => {});
}

/** How often the position is saved while a job runs. */
const kProgressInterval = 2000;

let stopRequested = false;
/** Called by Stop, so that the job ending next counts as stopped rather than finished. */
export function noteJobStopRequested() {
  stopRequested = true;
}

/** Offer to resume the recorded job, if its progress was saved. */
async function offerResume(host: string, reason: string, progress?: JobProgressLog) {
  const [record, saved] = await Promise.all([loadJobRecord(host), progress ? Promise.resolve(progress) : loadJobProgress(host)]);
  if (!record || !saved || !saved.file.endsWith(record.sdFile) || saved.at < record.startedAt) return;
  interruptedJob.value = { record, progress: saved, reason };
}

/** Load the recorded job's toolpath and settings into the app, and optionally its machine state. */
export function applyRecord(api: CncApi, record: JobRecord, { machineState }: { machineState: boolean }) {
  const store = useStore.getState();
  store.updateToolpath(record.gcode, record.toolpathName ?? undefined);
  store.setToolpathOffset(new Vector3(record.toolpathOffset.x, record.toolpathOffset.y, record.toolpathOffset.z));
  store.setStockHeight(record.stockHeight);
  store.setToolDiameter(record.toolDiameter);
  if (machineState) {
    api.jobStartedAt.value = record.startedAt;
    api.homed.value = record.homed;
    api.zZeroedAt.value = record.zZeroedAt;
  }
}

/**
 * After a reload or reconnect during a job camNC started: show that job's toolpath and progress again, but only when
 * it provably is that job (see {@link recoveryAction}). G-code is never read back from the controller.
 */
export function watchJobRecovery(api: CncApi) {
  let checkedFor: string | null = null;
  let jobSeen = false;
  let jobStart = 0;
  let lastPercent: number | null = null;
  let lastSaved = 0;
  return effect(() => {
    const host = api.host.value;
    const connected = api.isConnected.value;
    const status = api.status.value;
    if (!connected) {
      checkedFor = null;
      jobSeen = false;
      return;
    }
    if (host && status?.job) {
      if (!jobSeen) {
        jobSeen = true;
        jobStart = api.jobStartedAt.value ?? Date.now();
        stopRequested = false;
        interruptedJob.value = null;
      }
      lastPercent = status.job.percent;
      // Where the job is, for resuming after a power cycle, reset or alarm (see resume.ts).
      const now = Date.now();
      if (now - lastSaved >= kProgressInterval) {
        lastSaved = now;
        const { percent, file } = status.job;
        void saveJobProgress({ host, file, percent, mpos: status.mpos, wco: status.wco, at: now }).catch(() => {});
      }
    } else if (jobSeen && host && status && status.state !== 'Run' && status.state !== 'Hold' && status.state !== 'Door') {
      // A job seen ending while connected.
      jobSeen = false;
      // jobStartedAt is already cleared by now.
      const lastAlarm = api.lastAlarm.value;
      const ending = jobEnding({
        state: status.state,
        lastPercent,
        stopRequested,
        alarmSinceStart: !!lastAlarm && lastAlarm.at >= jobStart,
      });
      stopRequested = false;
      if (ending.finished) void clearJobRecord(host).catch(() => {});
      else void offerResume(host, ending.reason).catch(() => {});
    }
    if (!host || !status || checkedFor === host) return;
    checkedFor = host;
    void Promise.all([loadJobRecord(host), loadJobProgress(host)])
      .then(([record, progress]) => {
        if (!record || api.host.value !== host) return;
        const action = recoveryAction({
          record,
          status,
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
            toast('A job camNC started is still running', {
              description: 'You have loaded a different toolpath since. Show the running job instead?',
              duration: Infinity,
              action: { label: 'Show running job', onClick: () => applyRecord(api, record, { machineState: true }) },
            });
            break;
          case 'mismatch':
            toast.info('A job is running from the SD card', {
              description: `${action.reason} Its progress is shown without the toolpath.`,
            });
            break;
          case 'interrupted':
            void offerResume(
              host,
              `The job was last seen at ${action.progress.percent.toFixed(1)}% and is no longer running: the controller was power cycled or reset, or the job ended while camNC was not connected.`,
              action.progress
            );
            break;
          case 'ended':
            toast('Job finished or stopped while this page was closed', {
              duration: Infinity,
              action: {
                label: 'Load its toolpath',
                onClick: () => {
                  applyRecord(api, record, { machineState: false });
                  void clearJobRecord(host);
                },
              },
              cancel: { label: 'Dismiss', onClick: () => void clearJobRecord(host) },
            });
            break;
        }
      })
      .catch(() => {
        // No IndexedDB (private window): nothing to recover.
      });
  });
}
