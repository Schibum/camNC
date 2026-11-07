import { getCncApi, getExistingCncApi } from '@/lib/fluidnc/machine';
import { useCamMachine } from './camMachine';
import { interruptedJob, recoveryPending } from '@/lib/machine/jobRecovery';
import { matchesResumableSetup } from './manufacturingSnapshot';

/** A program runs on the machine, or is paused partway: what's loaded, and the board's holds, stay as they are. */
export function useMachineBusy(connect = true): boolean {
  'use no memo';
  const api = connect ? getCncApi() : getExistingCncApi();
  const preparingRun = useCamMachine(s => s.preparingRun);
  const jobId = useCamMachine(s => s.jobId);
  const active = useCamMachine(s => s.active);
  const runSnapshot = useCamMachine(s => s.runSnapshot);
  return (
    preparingRun ||
    (!!api && (api.jobProgress.value !== null || api.jobStartedAt.value !== null)) ||
    matchesResumableSetup({ jobId, active, runSnapshot }, interruptedJob.value?.record.camSnapshot)
  );
}

/** Setup replacement additionally waits for recovery hydration and explicit review of a physical run. */
export function useMachineSetupLocked(connect = true): boolean {
  const busy = useMachineBusy(connect);
  const review = useCamMachine(s => s.runReview);
  const snapshot = useCamMachine(s => s.runSnapshot);
  return busy || recoveryPending.value || (!!review && !!snapshot);
}

/** The reason a setup is protected, separate from whether the controller is physically moving. */
export function useMachineLockReason(connect = true): string | null {
  'use no memo';
  const api = connect ? getCncApi() : getExistingCncApi();
  const state = useCamMachine(s => s);
  if (state.preparingRun) return 'Preparing a program. Wait for preparation to finish.';
  if (recoveryPending.value) return 'Checking the saved machine job before replacing this setup.';
  if (api && (api.jobProgress.value !== null || api.jobStartedAt.value !== null)) return 'Locked while the program runs.';
  if (matchesResumableSetup(state, interruptedJob.value?.record.camSnapshot))
    return 'An interrupted program can resume. Resume or dismiss it before changing this setup.';
  if (state.runReview && state.runSnapshot) {
    if (state.runPreparationError) return state.runPreparationError;
    if (state.runReview === 'finished')
      return 'The program finished. Review its original setup and close the review before starting another program.';
    if (state.runReview === 'stopped') return 'The program stopped. Review its original setup before changing it.';
    return 'Review the original execution before changing this setup.';
  }
  return null;
}
