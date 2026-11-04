import { getCncApi } from '@/lib/fluidnc/machine';

/** A program runs on the machine, or is paused partway: what's loaded, and the board's holds, stay as they are. */
export function useMachineBusy(): boolean {
  'use no memo';
  const api = getCncApi();
  return api.jobProgress.value !== null || api.jobStartedAt.value !== null;
}
