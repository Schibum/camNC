import { physicalSheetIdOf } from '../boards';
import { getJob, modelKey, updateJobForModel } from '../jobDb';
import { useCamMachine } from './camMachine';
import { nativeRunHistoryChanged } from './nativeRunEvents';

/** A confirmed physical placement must survive the next program, not just the running snapshot. */
export async function saveMachinePlacement(x: number, y: number, stillCurrent: () => boolean) {
  const state = useCamMachine.getState();
  if (!state.jobId) return;
  const boardId = state.overlay?.boardId;
  if (!boardId) throw new Error('Wait for the board setup before changing its placement.');
  const side = state.overlay?.side ?? 'a';
  const source = await getJob(state.jobId);
  if (!source || !stillCurrent()) throw new Error('The machine setup changed before its placement could be saved.');
  const loaded = state.loadedSnapshot;
  if (loaded && loaded.sourceKey !== modelKey(source)) throw new Error('The design changed. Review its setup before moving the zero.');
  const original = loaded?.queue.find(e => e.key === loaded.active)?.board.board;
  const baseline = original ?? source.boards?.find(b => b.id === boardId);
  if (!baseline) throw new Error('The board has not been saved. Review it on Boards before running.');
  const expectedSheet = physicalSheetIdOf(baseline);
  const saved = await updateJobForModel(source, current => {
    if (!stillCurrent()) return null;
    const board = current.boards?.find(b => b.id === boardId);
    if ((!board && (!original || loaded?.boardWasSaved)) || (board && physicalSheetIdOf(board) !== expectedSheet)) return null;
    const before = board ?? baseline;
    const next = { ...before, bed: { ...before.bed, [side]: { ...before.bed?.[side], x, y, deg: state.overlay?.rotationDeg ?? 0 } } };
    return { ...current, boards: board ? current.boards!.map(b => (b.id === boardId ? next : b)) : [...(current.boards ?? []), next] };
  });
  if (!saved) throw new Error('The physical sheet or setup changed before its placement could be saved.');
  window.dispatchEvent(new CustomEvent(nativeRunHistoryChanged, { detail: saved.id }));
}
