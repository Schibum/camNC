import { getCncApi, getExistingCncApi } from '@/lib/fluidnc/machine';

/** A program runs on the machine, or is paused partway: what's loaded, and the board's holds, stay as they are. */
export function useMachineBusy(connect = true): boolean {
  'use no memo';
  const api = connect ? getCncApi() : getExistingCncApi();
  return !!api && (api.jobProgress.value !== null || api.jobStartedAt.value !== null);
}
