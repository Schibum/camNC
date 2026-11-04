import { useStore } from '@/store/store';
import { Button } from '@wbcnc/ui/components/button';
import { toast } from '@wbcnc/ui/components/sonner';
import { cn } from '@wbcnc/ui/lib/utils';
import { Hand, Minus, Plus, Undo2 } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { useHotkeys } from 'react-hotkeys-hook';
import type { BoardV1 } from '../boards';
import { placeBoard, useBedEdit, type BedEdit, type BedEditMode } from './bedEdit';
import { entryHolds, entrySide, useCamMachine } from './camMachine';
import { useMachineBusy } from './useMachineBusy';
import { useMachineQueue } from './useMachineQueue';

interface Undo {
  boardId: string;
  what: string;
  /** The board's fields before the edit. */
  before: Partial<BoardV1>;
}

/**
 * Editing the CAM job's board in the top view (outside the 3D canvas): saves what the overlay changes (holds moved,
 * added, removed; the board's spot on the bed when its outline is dragged), keeps the overlay's holds up to date as
 * the board is planned again, and the tools to switch what a tap does, with Undo.
 */
export function CamBedEditor() {
  const jobId = useCamMachine(s => s.jobId);
  return jobId ? <Editor /> : null;
}

function Editor() {
  const { current, updateBoard } = useMachineQueue();
  const overlay = useCamMachine(s => s.overlay);
  const setOverlay = useCamMachine(s => s.setOverlay);
  const { mode, setMode, setApply } = useBedEdit();
  const busy = useMachineBusy();
  const undo = useRef<Undo[]>([]);
  const board = current?.board.board;

  const save = (edit: BedEdit, silent = false) => {
    if (!current || current.board.board.id !== edit.boardId) return;
    const b = current.board.board;
    // At the machine the board is a real sheet: one fitted to its parts keeps its size and layout once a hold is edited
    // here. Only a part the hold now lands on moves; the board doesn't grow around the hold (which would bring the
    // suggested holds back) and the other parts don't shuffle.
    if (edit.patch.holdPoints && b.size.fit) {
      const { nest } = current.board;
      const positions = Object.fromEntries(nest.placements.map(p => [p.id, { x: p.x, y: p.y, rotated: p.rotated }]));
      edit = {
        ...edit,
        patch: {
          ...edit.patch,
          size: { fit: false, w: nest.board.w, h: nest.board.h },
          positions: { ...positions, ...b.positions },
          pinned: [...new Set([...(b.pinned ?? []), ...Object.keys(positions)])],
        },
      };
    }
    const before = Object.fromEntries(Object.keys(edit.patch).map(k => [k, b[k as keyof BoardV1]])) as Partial<BoardV1>;
    updateBoard(edit.boardId, edit.patch);
    if (silent) return;
    undo.current = [...undo.current.slice(-19), { boardId: edit.boardId, what: edit.what, before }];
    toast(`${edit.what}: planning again`, { action: { label: 'Undo', onClick: undoLast } });
  };
  const undoLast = () => {
    const last = undo.current.pop();
    if (!last) return;
    updateBoard(last.boardId, last.before);
    toast(`Undone: ${last.what}`);
  };

  // The overlay saves through this while the top view shows this job.
  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => {
    setApply(edit => saveRef.current(edit));
    return () => setApply(null);
  }, [setApply]);

  // The board was planned again (a hold moved here or in Boards): the overlay shows its holds as they are now.
  const holds = current ? entryHolds(current) : null;
  const holdsKey = JSON.stringify([holds?.holds, holds?.holdClash, holds?.bit, holds?.stockTop, holds?.path?.length]);
  useEffect(() => {
    const o = useCamMachine.getState().overlay;
    if (!o || !holds || o.boardId !== holds.boardId) return;
    setOverlay({ ...o, ...holds });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [holdsKey]);

  // The outline dragged onto the board: the board's spot on the bed, for this side, kept with the job.
  const dragging = useStore(s => s.isToolpathDragging);
  const wasDragging = useRef(false);
  useEffect(() => {
    if (wasDragging.current && !dragging && current && board && overlay?.boardId === board.id) {
      const { x, y } = useStore.getState().toolpathOffset;
      const side = entrySide(current);
      const spot = board.bed?.[side];
      if (!spot || Math.abs(spot.x - x) > 0.05 || Math.abs(spot.y - y) > 0.05) save(placeBoard(board, side, { x, y }), true);
    }
    wasDragging.current = dragging;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragging]);

  useHotkeys('escape', () => setMode('move'));
  // Undo for edits made here; the board's own fields are what's restored.
  useHotkeys('mod+z', e => {
    if (!undo.current.length) return;
    e.preventDefault();
    undoLast();
  });

  if (!overlay?.holds || overlay.side === 'b' || !current) return null;
  const clamp = (overlay.holdLike?.kind ?? overlay.holds[0]?.kind) === 'clamp';
  const name = clamp ? 'clamp' : 'screw';
  const tool = (m: BedEditMode, label: string, icon: React.ReactNode, hint: string) => (
    <Button
      size="sm"
      variant={mode === m ? 'default' : 'ghost'}
      aria-pressed={mode === m}
      title={hint}
      disabled={busy}
      onClick={() => setMode(mode === m && m !== 'move' ? 'move' : m)}>
      {icon}
      {label}
    </Button>
  );
  return (
    <div
      role="toolbar"
      aria-label={`Edit the ${name}s`}
      className="dark pointer-events-auto flex flex-wrap items-center gap-1 rounded-lg border bg-background/90 p-1 text-foreground shadow-md backdrop-blur">
      {tool('move', `Move`, <Hand />, `Drag a ${name} to where it fits better: the program follows.`)}
      {tool('add', `Add ${name}`, <Plus />, `Tap the board where another ${name} goes.`)}
      {tool('remove', `Remove`, <Minus />, `Tap a ${name} to remove it.`)}
      <Button size="sm" variant="ghost" title="Undo the last change here (⌘Z)" disabled={busy || !undo.current.length} onClick={undoLast}>
        <Undo2 />
        Undo
      </Button>
      <span className={cn('px-2 text-xs text-muted-foreground', !busy && mode === 'move' && 'hidden')}>
        {busy ? 'Locked while the program runs' : mode === 'add' ? `Tap the board to add a ${name}` : `Tap a ${name} to remove it`}
      </span>
    </div>
  );
}
