import { getCncApi } from '@/lib/fluidnc/machine';
import { useStore } from '@/store/store';
import { Button } from '@wbcnc/ui/components/button';
import { toast } from '@wbcnc/ui/components/sonner';
import { cn } from '@wbcnc/ui/lib/utils';
import { Hand, Minus, Plus, Undo2 } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { Vector3 } from 'three';
import { useHotkeys } from 'react-hotkeys-hook';
import { cutLabel, isCut, placedRect, spotFree, type BoardV1 } from '../boards';
import {
  freezeAtMachine,
  moveHold,
  movePart,
  nudgeStep,
  placeBoard,
  removeHold,
  turn,
  turnAboutMiddle,
  turnBoard,
  useBedEdit,
  type BedEdit,
  type BedEditMode,
  type BedPart,
  type BedSelection,
  type GhostBoard,
} from './bedEdit';
import { entryHolds, entryRotation, entrySide, rotationKey, useCamMachine } from './camMachine';
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
  const { current, updateBoard, queue, done, instances, nestBit } = useMachineQueue();
  const rotation = useCamMachine(s => s.rotation);
  const setRotation = useCamMachine(s => s.setRotation);
  const setActive = useCamMachine(s => s.setActive);
  const setBed = useBedEdit(s => s.setBed);
  const overlay = useCamMachine(s => s.overlay);
  const setOverlay = useCamMachine(s => s.setOverlay);
  const { mode, setMode, setApply } = useBedEdit();
  const side = current ? entrySide(current) : 'a';
  const busy = useMachineBusy();
  const undo = useRef<Undo[]>([]);
  const board = current?.board.board;

  const save = (edit: BedEdit, silent = false) => {
    if (!current || current.board.board.id !== edit.boardId) return;
    const b = current.board.board;
    // A real sheet at the machine: a hold edited there leaves the board's size and the other parts as they are.
    if (edit.patch.holdPoints) edit = { ...edit, patch: { ...freezeAtMachine(b, current.board.nest), ...edit.patch } };
    const before = Object.fromEntries(Object.keys(edit.patch).map(k => [k, b[k as keyof BoardV1]])) as Partial<BoardV1>;
    updateBoard(edit.boardId, edit.patch);
    if (silent) return;
    undo.current = [...undo.current.slice(-19), { boardId: edit.boardId, what: edit.what, before }];
    toast(`${edit.what}: planning again`, { id: 'bed-edit', action: { label: 'Undo', onClick: undoLast } });
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

  // The board's angle, turned here (the card's buttons, the corner handle): kept with the job, so it lies that way on
  // the next visit too.
  const deg = current ? entryRotation(current, rotation) : 0;
  const turnedHere = current ? rotation[rotationKey(current)] : undefined;
  useEffect(() => {
    if (!current || !board || turnedHere === undefined || board.bed?.[side]?.deg === turnedHere) return;
    save(turnBoard(board, side, turnedHere, useStore.getState().toolpathOffset), true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [turnedHere, board?.id, side]);

  // What the overlay can do besides the holds: the parts to drag, the board to turn, the other boards to switch to.
  const cutHere = !!current && queue.some(e => e.board.board.id === current.board.board.id && done.includes(e.doneId));
  const locked =
    board && (isCut(board) || cutHere)
      ? `Board ${board.name} is ${cutLabel(board).toLowerCase()}: its parts and holds stay as they are`
      : null;
  const ghosts: GhostBoard[] = [];
  for (const e of queue) {
    const b = e.board.board;
    if (b.id === board?.id || ghosts.some(g => g.id === b.id) || !e.board.nest.placements.length) continue;
    const spot = b.bed?.a ?? b.bed?.b;
    if (!spot) continue;
    const all = queue.filter(x => x.board.board.id === b.id && x.plan);
    ghosts.push({
      id: b.id,
      name: b.name,
      x: spot.x,
      y: spot.y,
      deg: spot.deg ?? 0,
      w: e.board.nest.board.w,
      h: e.board.nest.board.h,
      cut: all.length > 0 && all.every(x => done.includes(x.doneId)),
    });
  }
  const nest = current?.board.nest;
  const parts: BedPart[] =
    nest && side === 'a'
      ? nest.placements.map(p => {
          const inst = instances.find(i => i.id === p.id);
          const r = inst ? placedRect(p, inst) : { w: 0, h: 0 };
          const movable = nest.placements.length > 1 || !board?.size.fit;
          return { id: p.id, name: inst?.name ?? p.id, x: p.x, y: p.y, w: r.w, h: r.h, rotated: p.rotated, movable };
        })
      : [];
  const bedKey = JSON.stringify([board?.id, parts, locked, ghosts, side, deg]);
  const ctx = useRef({ current, board, nest, instances, nestBit, side, deg });
  ctx.current = { current, board, nest, instances, nestBit, side, deg };
  useEffect(() => {
    if (!board) return setBed(null);
    setBed({
      boardId: board.id,
      parts,
      locked,
      ghosts,
      check: (item, at) => {
        const { nest: n, instances: all } = ctx.current;
        if (!n) return 'off';
        const inst = all.find(i => i.id === item);
        if (!inst) return 'off';
        const r = placedRect(at, inst);
        if (r.x + r.w < 0 || r.y + r.h < 0 || r.x > n.board.w || r.y > n.board.h) return 'off';
        return spotFree(n, all, item, at) ? 'free' : 'taken';
      },
      drop: (item, at) => {
        const { board: b, nest: n, instances: all, nestBit: bit } = ctx.current;
        if (!b || !n) return;
        const edit = movePart(b, n, all, bit, item, at);
        if (!edit)
          return void toast.error(`${all.find(i => i.id === item)?.name ?? 'The part'} doesn’t fit there, nor anywhere else on the board.`);
        saveRef.current(edit);
      },
      // Turned (the knob, the panel): about its middle, so its XY zero moves too. Saved first, so the program goes to
      // the new spot when it's loaded at the new angle.
      rotate: (d, at) => {
        const { current: c, board: b, side: sd, deg: from } = ctx.current;
        const o = useCamMachine.getState().overlay;
        if (!c || !b) return;
        const s = useStore.getState();
        const to = at ?? (o ? turnAboutMiddle(s.toolpathOffset, o, from, d) : s.toolpathOffset);
        s.setToolpathOffset(new Vector3(to.x, to.y, s.toolpathOffset.z));
        saveRef.current(turnBoard(b, sd, d, to), true);
        setRotation(rotationKey(c), d);
      },
      show: id => setActive(`${id}:`),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bedKey]);
  useEffect(() => () => setBed(null), [setBed]);

  // The keys, for fine moves and for whatever a finger can't reach: arrows nudge what's selected (a hold, a part) or
  // else the board, along the machine axis that points their way on screen; 1 mm, Shift 10, Alt 0.1. Tab picks the
  // next hold or part, Delete removes a hold.
  const selected = useBedEdit(s => s.selected);
  const setSelected = useBedEdit(s => s.setSelected);
  useEffect(() => setSelected(null), [board?.id, side, setSelected]);
  const nudge = (key: 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown', e: KeyboardEvent) => {
    const axis = useBedEdit.getState().arrowAxis?.(key);
    if (!axis || !current || !board || busy) return;
    e.preventDefault();
    const step = nudgeStep(e);
    const d = { x: axis.x * step, y: axis.y * step };
    const sel = useBedEdit.getState().selected;
    const o = useCamMachine.getState().overlay;
    // The board frame is turned by the board's angle: a machine-axis step, in it.
    const local = turn(d, -deg);
    if (sel?.kind === 'hold' && o?.holds?.[sel.i] && !locked) {
      const h = o.holds[sel.i];
      save(moveHold(o.holds, sel.i, { x: h.x + local.x, y: h.y + local.y }, o.holdsOn ?? { w: o.w, h: o.h }, board.id));
    } else if (sel?.kind === 'part' && !locked) {
      const p = current.board.nest.placements.find(x => x.id === sel.id);
      if (!p) return;
      const edit = movePart(board, current.board.nest, instances, nestBit, sel.id, {
        x: p.x + local.x,
        y: p.y + local.y,
        rotated: p.rotated,
      });
      if (edit?.exact) save(edit);
      else toast.error('No room there: it would come too close to another part, a hold or the edge.', { id: 'bed-edit' });
    } else if (!sel) {
      const s = useStore.getState();
      const at = { x: s.toolpathOffset.x + d.x, y: s.toolpathOffset.y + d.y };
      s.setToolpathOffset(new Vector3(at.x, at.y, s.toolpathOffset.z));
      save(placeBoard(board, side, at), true);
    }
  };
  // With keyboard jog on, the arrows move the machine: they never nudge then too.
  const jogKeys = useStore(s => s.machinePrefs.keyboardJog) && getCncApi().canJog.value;
  const keyOpts = { enabled: !!board && !busy };
  const arrowOpts = { enabled: keyOpts.enabled && !jogKeys };
  useHotkeys('left, shift+left, alt+left', e => nudge('ArrowLeft', e), arrowOpts, [nudge]);
  useHotkeys('right, shift+right, alt+right', e => nudge('ArrowRight', e), arrowOpts, [nudge]);
  useHotkeys('up, shift+up, alt+up', e => nudge('ArrowUp', e), arrowOpts, [nudge]);
  useHotkeys('down, shift+down, alt+down', e => nudge('ArrowDown', e), arrowOpts, [nudge]);
  useHotkeys(
    'delete, backspace',
    e => {
      const sel = useBedEdit.getState().selected;
      const o = useCamMachine.getState().overlay;
      if (sel?.kind !== 'hold' || !o?.holds || !board || locked) return;
      e.preventDefault();
      save(removeHold(o.holds, sel.i, o.holdsOn ?? { w: o.w, h: o.h }, board.id));
      setSelected(null);
    },
    keyOpts,
    [locked, board]
  );
  useHotkeys(
    'tab, shift+tab',
    e => {
      const o = useCamMachine.getState().overlay;
      const all: BedSelection[] = [
        ...(o?.holds ?? []).map((_, i) => ({ kind: 'hold' as const, i })),
        ...parts.filter(p => p.movable).map(p => ({ kind: 'part' as const, id: p.id })),
      ];
      if (!all.length) return;
      e.preventDefault();
      const sel = useBedEdit.getState().selected;
      const at = all.findIndex(x => JSON.stringify(x) === JSON.stringify(sel));
      const next = (at + (e.shiftKey ? -1 : 1) + all.length + (at < 0 && e.shiftKey ? 1 : 0)) % all.length;
      setSelected(all[next]);
    },
    keyOpts,
    [parts]
  );

  useHotkeys('escape', () => {
    setMode('move');
    setSelected(null);
  });
  // Undo for edits made here; the board's own fields are what's restored.
  useHotkeys('mod+z', e => {
    if (!undo.current.length) return;
    e.preventDefault();
    undoLast();
  });

  if (!overlay || !current || !board || overlay.boardId !== board.id) return null;
  const holdsHere = !!overlay.holds && overlay.side !== 'b';
  const clamp = (overlay.holdLike?.kind ?? overlay.holds?.[0]?.kind) === 'clamp';
  const name = clamp ? 'clamp' : 'screw';
  const off = busy || !!locked;
  const tool = (m: BedEditMode, label: string, icon: React.ReactNode, hint: string) => (
    <Button
      size="sm"
      variant={mode === m ? 'default' : 'ghost'}
      aria-pressed={mode === m}
      title={hint}
      disabled={off}
      onClick={() => setMode(mode === m && m !== 'move' ? 'move' : m)}>
      {icon}
      {label}
    </Button>
  );
  const note = busy
    ? 'Locked while the program runs'
    : locked
      ? `${locked}. Start over in Boards to change them.`
      : mode === 'add'
        ? `Tap the board to add a ${name}`
        : mode === 'remove'
          ? `Tap a ${name} to remove it`
          : side === 'a'
            ? selected
              ? `${selected.kind === 'hold' ? `${clamp ? 'Clamp' : 'Screw'} ${selected.i + 1}` : (parts.find(p => p.id === selected.id)?.name ?? 'Part')} selected: arrow keys nudge it${selected.kind === 'hold' ? ', Delete removes it' : ''}, Esc deselects`
              : `Drag the board, a part or a ${holdsHere ? name : 'hold'} (Shift: along X or Y only); the knob turns the board. ${jogKeys ? 'Arrow keys jog the machine (keyboard jog is on).' : 'Arrow keys nudge.'}`
            : 'Drag the board to move it; the knob turns it';
  return (
    <div
      role="toolbar"
      aria-label={`Edit board ${board.name}`}
      className="dark pointer-events-auto flex flex-wrap items-center gap-1 rounded-lg border bg-background/90 p-1 text-foreground shadow-md backdrop-blur">
      {holdsHere && (
        <>
          {tool('move', `Move`, <Hand />, `Drag a part or a ${name} to where it fits better: the program follows.`)}
          {tool('add', `Add ${name}`, <Plus />, `Tap the board where another ${name} goes.`)}
          {tool('remove', `Remove`, <Minus />, `Tap a ${name} to remove it.`)}
        </>
      )}
      <Button size="sm" variant="ghost" title="Undo the last change here (⌘Z)" disabled={busy || !undo.current.length} onClick={undoLast}>
        <Undo2 />
        Undo
      </Button>
      <span className={cn('px-2 text-xs text-muted-foreground', (busy || locked) && 'text-amber-300')}>{note}</span>
    </div>
  );
}
