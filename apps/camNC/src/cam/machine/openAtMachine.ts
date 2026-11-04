import { selectMachineBounds, useStore } from '@/store/store';
import { clearMachineView } from '../showOnMachine';
import { useCamMachine } from './camMachine';

/** An active entry no entry has: the first one still to cut is loaded (see `currentEntry`). */
export const kFirstToCut = ':';

/**
 * The job at the machine, on a board: its queue in the machine panel, the board's next program loaded. The same job
 * keeps what's loaded and cut; another job starts afresh. Where to go next: the top view, or picking a bed first.
 */
export function openAtMachine(jobId: string, boardId?: string): '/visualize/2DView' | '/start' {
  const machine = useCamMachine.getState();
  if (machine.jobId !== jobId) {
    machine.start(jobId);
    clearMachineView();
  }
  // A board's id and a colon: the first of its entries still to cut (see `currentEntry`). No board: the first entry of
  // the job still to cut, unless one is loaded.
  const active = useCamMachine.getState().active;
  if (boardId && !active?.startsWith(`${boardId}:`)) machine.setActive(`${boardId}:`);
  else if (!boardId && !active) machine.setActive(kFirstToCut);
  useStore.getState().setMachinePanelOpen(true);
  return selectMachineBounds(useStore.getState()) ? '/visualize/2DView' : '/start';
}
