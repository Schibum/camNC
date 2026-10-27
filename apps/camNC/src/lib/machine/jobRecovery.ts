import { effect } from '@preact/signals-react';
import { toast } from '@wbcnc/ui/components/sonner';
import { Vector3 } from 'three';
import { useStore } from '../../store/store';
import type { CncApi } from '../fluidnc/cnc-api';
import { clearJobRecord, JobRecord, loadJobRecord, recoveryAction } from './jobRecord';

/** Load the recorded job's toolpath and settings into the app, and optionally its machine state. */
function applyRecord(api: CncApi, record: JobRecord, { machineState }: { machineState: boolean }) {
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
  return effect(() => {
    const host = api.host.value;
    const connected = api.isConnected.value;
    const status = api.status.value;
    if (!connected) {
      checkedFor = null;
      jobSeen = false;
      return;
    }
    // A job seen ending while connected is over: it must not come back as "finished while this page was closed".
    if (status?.job) jobSeen = true;
    else if (jobSeen && host && status?.state === 'Idle') {
      jobSeen = false;
      void clearJobRecord(host).catch(() => {});
    }
    if (!host || !status || checkedFor === host) return;
    checkedFor = host;
    void loadJobRecord(host)
      .then(record => {
        if (!record || api.host.value !== host) return;
        const action = recoveryAction({
          record,
          status,
          currentGcode: useStore.getState().toolpath?.gcode ?? null,
          lastAlarm: api.lastAlarm.value,
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
