import type { BoardV1 } from '@/cam/boards';
import { useCuttingData } from '@/cam/cuttingData';
import { createJob, getModelBytes, type CamJobV1 } from '@/cam/jobDb';
import { useCamMachine } from '@/cam/machine/camMachine';
import { openAtMachine } from '@/cam/machine/openAtMachine';
import { useToolLibrary } from '@/cam/toolLibrary';
import { getCncApi, getExistingCncApi } from '@/lib/fluidnc/machine';
import { useStore } from '@/store/store';
import { Box2, Vector2 } from 'three';
import { exitDemo, getRehearsalId, isDemoMode } from '../demo/demo-mode';
import { getDemoMachine } from '../demo/demo-machine';
import {
  cleanExpiredSnapshots,
  deleteSnapshot,
  loadSnapshot,
  makeSnapshot,
  returnToSource,
  saveSnapshot,
  type RehearsalSnapshot,
} from './snapshots';

let active: RehearsalSnapshot | null = null;
export const getActiveRehearsal = () => active;

/** Rechecked at the actual handoff, not just when the button was rendered. */
export function rehearsalBlockedReason() {
  const api = getExistingCncApi();
  if (!api) return null;
  if (
    api.jobProgress.value !== null ||
    api.jobStartedAt.value !== null ||
    ['Run', 'Hold', 'Door', 'Jog', 'Home'].includes(api.status.value?.state ?? '')
  )
    return 'Finish or stop the real machine job before starting a rehearsal.';
  return null;
}

export async function launchRehearsal(job: CamJobV1, boards: BoardV1[], signal?: AbortSignal) {
  if (isDemoMode()) throw new Error('Return to your saved CAM project before starting another rehearsal.');
  const blocked = rehearsalBlockedReason();
  if (blocked) throw new Error(blocked);
  const model = await getModelBytes(job.id);
  if (!model) throw new Error('The model file is missing. Open it again before rehearsing.');
  const snapshot = makeSnapshot(job, model, boards, {
    bits: useToolLibrary.getState().bits,
    cutting: useCuttingData.getState().saved,
    pauseEachTab: useCamMachine.getState().pauseEachTab,
    spindle: useStore.getState().machinePrefs.spindleSwitch ?? 'hand',
  });
  await cleanExpiredSnapshots();
  await saveSnapshot(snapshot);
  // Navigation and reload need a tab-local token; blocked session storage must fail before leaving the real app.
  try {
    sessionStorage.setItem('camnc-rehearsal', snapshot.id);
    if (sessionStorage.getItem('camnc-rehearsal') !== snapshot.id) throw new Error('Tab storage is unavailable.');
    signal?.throwIfAborted();
    const changed = rehearsalBlockedReason();
    if (changed) throw new Error(changed);
    location.assign(`/demo?rehearsal=${snapshot.id}&camera=off`);
  } catch (e) {
    try {
      sessionStorage.removeItem('camnc-rehearsal');
    } catch {
      /* Storage can be blocked. */
    }
    await deleteSnapshot(snapshot.id).catch(() => {});
    throw e;
  }
}

/** Called after installing the simulator, before the router, settings gate or machine connection can start. */
export async function prepareRehearsal() {
  const id = getRehearsalId();
  if (!isDemoMode() || !id) throw new Error('No rehearsal was selected.');
  // Without a remembered tab token, the next reload could restore real settings. Refuse to enter that state.
  if (sessionStorage.getItem('camnc-rehearsal') !== id) throw new Error('Tab storage is unavailable.');
  const snapshot = await loadSnapshot(id);
  const job = await createJob(new File([snapshot.model.slice().buffer], snapshot.job.fileName), {
    ...snapshot.job,
    // createJob assigns a new id and timestamps; physical board history was removed by makeSnapshot.
    boards: snapshot.job.boards,
  });
  useToolLibrary.setState({ bits: snapshot.bits, imports: [] });
  useCuttingData.setState({ saved: snapshot.cutting });
  useCamMachine.getState().leave();
  useCamMachine.getState().setPauseEachTab(snapshot.pauseEachTab);
  const width = Math.max(618, ...snapshot.job.boards!.map(b => (b.size.fit ? 0 : b.size.w + 80)));
  const height = Math.max(1238, ...snapshot.job.boards!.map(b => (b.size.fit ? 0 : b.size.h + 80)));
  useStore.setState(s => {
    s.camSources = {};
    s.activeCamId = null;
    s.machineBounds = new Box2(new Vector2(0, 0), new Vector2(width, height));
    s.machinePrefs.spindleSwitch = snapshot.spindle;
  });
  openAtMachine(job.id);
  active = snapshot;
}

/** Cleanup is best effort; expired handoffs are collected next time. Physical source jobs are never written. */
export async function leaveRehearsal() {
  getCncApi().disconnect();
  getDemoMachine()?.dispose();
  const snapshot = active;
  try {
    if (snapshot) await deleteSnapshot(snapshot.id);
  } catch {
    // Cleanup is retried by expiry collection; returning must still work when storage is unavailable.
  } finally {
    exitDemo(snapshot ? returnToSource(snapshot.sourceId) : '/cam');
  }
}
