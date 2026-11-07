import { Html, Line } from '@react-three/drei';
import { CanvasLabel } from '@/scene/CanvasLabel';
import { useThree, type ThreeEvent } from '@react-three/fiber';
import { cn } from '@wbcnc/ui/lib/utils';
import { Move, Pencil, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Plane, Raycaster, Vector2, Vector3, type Camera } from 'three';
import { holdBox } from '@wbcnc/cam/holdPoints';
import { useStore } from '@/store/store';
import {
  addHold,
  bedToBoard,
  hitsPath,
  lockAxis,
  moveHold,
  nearestAxis,
  onBoard,
  pickAt,
  placeHold,
  removeHold,
  snapAngle,
  turn,
  useBedEdit,
  type Axis,
  type BedNote,
} from './bedEdit';
import { isManufacturingLocked, useCamMachine, type BoardOverlay } from './camMachine';

type P2 = { x: number; y: number };
type Controls = { enabled: boolean } | null;

const kZ = 0.25;
const kSelected = '#fbbf24';
const kTone = { info: '#c4b5fd', warn: '#f59e0b', bad: '#ef4444' } as const;
/** Moved less than this on screen between press and release: a tap (select), never a tiny move. */
const kTapPx = 4;

const rectLine = (r: { x: number; y: number; w: number; h: number }, z = kZ): [number, number, number][] => [
  [r.x, r.y, z],
  [r.x + r.w, r.y, z],
  [r.x + r.w, r.y + r.h, z],
  [r.x, r.y + r.h, z],
  [r.x, r.y, z],
];

const kBed = new Plane(new Vector3(0, 0, 1), 0);

/** The bed point (scene z = 0) under a screen point of the canvas. */
function bedAt(clientX: number, clientY: number, camera: Camera, el: HTMLElement): P2 | null {
  const r = el.getBoundingClientRect();
  const ndc = new Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
  const ray = new Raycaster();
  ray.setFromCamera(ndc, camera);
  const hit = ray.ray.intersectPlane(kBed, new Vector3());
  return hit ? { x: hit.x, y: hit.y } : null;
}

interface DragHandlers {
  /** The pointer moved (bed coordinates), past the tap distance. */
  move: (p: P2, from: P2, e: PointerEvent) => void;
  /** Let go anywhere (or the window lost focus): `moved` false is a tap. */
  end: (moved: boolean, p: P2 | null) => void;
}

/**
 * A drag that follows the pointer over the whole window and ends on any release: over a label, past the canvas, or
 * after what's dragged moved away under the pointer. The view's own panning is off meanwhile.
 */
function useWindowDrag() {
  const camera = useThree(s => s.camera);
  const el = useThree(s => s.gl.domElement);
  const controls = useThree(s => s.controls) as Controls;
  return (e: ThreeEvent<PointerEvent>, h: DragHandlers) => {
    if (isManufacturingLocked()) return;
    e.stopPropagation();
    const from = bedAt(e.nativeEvent.clientX, e.nativeEvent.clientY, camera, el);
    if (!from) return;
    const [sx, sy] = [e.nativeEvent.clientX, e.nativeEvent.clientY];
    let moved = false;
    let last: P2 | null = from;
    if (controls) controls.enabled = false;
    const onMove = (ev: PointerEvent) => {
      if (isManufacturingLocked()) return;
      if (!moved && Math.hypot(ev.clientX - sx, ev.clientY - sy) < kTapPx) return;
      moved = true;
      last = bedAt(ev.clientX, ev.clientY, camera, el) ?? last;
      if (last) h.move(last, from, ev);
    };
    const done = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', done);
      window.removeEventListener('pointercancel', done);
      window.removeEventListener('blur', done);
      if (controls) controls.enabled = true;
      if (isManufacturingLocked()) {
        useStore.getState().setIsToolpathDragging(false);
        return;
      }
      h.end(moved, last);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', done);
    window.addEventListener('pointercancel', done);
    window.addEventListener('blur', done);
  };
}

/** A note beside a spot (board frame): what just happened there. */
function Note({ note }: { note: BedNote }) {
  return (
    <CanvasLabel position={[note.at.x, note.at.y, 0.5]} offset={[16, -12]} zIndexRange={[20, 0]}>
      <span
        style={{ background: kTone[note.tone] }}
        className={cn(
          'block max-w-full rounded px-2 py-1 text-xs font-medium shadow-[0_1px_3px_rgba(0,0,0,0.6)]',
          note.tone === 'bad' ? 'text-white' : 'text-black'
        )}>
        {note.text}
      </span>
    </CanvasLabel>
  );
}

/**
 * Placing the board in the top view: a drag anywhere on it moves the whole board with its program (Shift: along X or
 * Y only), the knob above it turns it about its middle. A tap selects the screw, clamp or part there: it gets a move
 * handle (only the handle moves it, so a stray drag never does) and a small bar to remove it or change it in the CAM
 * job. Add mode: a tap adds a screw or clamp there.
 */
export function CamBedLayer({ overlay, offset, running }: { overlay: BoardOverlay; offset: P2; running: boolean }) {
  'use no memo';
  const bed = useBedEdit(s => s.bed);
  const mode = useBedEdit(s => s.mode);
  const apply = useBedEdit(s => s.apply);
  const selected = useBedEdit(s => s.selected);
  const note = useBedEdit(s => s.note);
  const camera = useThree(s => s.camera);
  const drag = useWindowDrag();
  // The board being moved (axis lock shown), turned (angle shown), or the selected item moved by its handle.
  const [axis, setAxis] = useState<Axis>(null);
  const [turning, setTurning] = useState<number | null>(null);
  const [item, setItem] = useState<P2 | null>(null);

  // The arrow keys move along the machine axis that points their way on screen, however the view is turned.
  useEffect(() => {
    const dirs = { ArrowRight: { x: 1, y: 0 }, ArrowLeft: { x: -1, y: 0 }, ArrowUp: { x: 0, y: -1 }, ArrowDown: { x: 0, y: 1 } };
    const onScreen = (v: Vector3) => {
      const o = new Vector3(0, 0, 0).project(camera);
      const q = v.clone().project(camera);
      return { x: q.x - o.x, y: -(q.y - o.y) };
    };
    useBedEdit.setState({
      arrowAxis: key => nearestAxis({ x: onScreen(new Vector3(1, 0, 0)), y: onScreen(new Vector3(0, 1, 0)) }, dirs[key]),
    });
    return () => useBedEdit.setState({ arrowAxis: null });
  }, [camera]);

  // A note shows for a moment.
  useEffect(() => {
    if (!note) return;
    const t = setTimeout(() => useBedEdit.getState().setNote(null), 2500);
    return () => clearTimeout(t);
  }, [note]);

  if (!bed || bed.boardId !== overlay.boardId || running) return null;
  const deg = overlay.rotationDeg;
  const sideA = overlay.side !== 'b';
  const holds = sideA ? (overlay.holds ?? []) : [];
  const holdsOn = overlay.holdsOn ?? { w: overlay.w, h: overlay.h };
  const parts = sideA ? bed.parts : [];
  const editable = !bed.locked;
  const say = (n: BedNote) => useBedEdit.getState().setNote(n);
  /** A step on the bed, in the board frame (turned by the board's angle). */
  const local = (d: P2) => turn(d, -deg);

  // The whole board: a drag moves it, a tap selects what's there (or adds a hold in Add mode).
  const onBoardDown = (e: ThreeEvent<PointerEvent>) => {
    const from = { x: offset.x, y: offset.y };
    let lock: Axis = null;
    drag(e, {
      move: (p, start, ev) => {
        useStore.getState().setIsToolpathDragging(true);
        const r = lockAxis({ x: p.x - start.x, y: p.y - start.y }, ev.shiftKey, lock);
        if (r.axis !== lock) setAxis((lock = r.axis));
        const s = useStore.getState();
        s.setToolpathOffset(new Vector3(from.x + r.d.x, from.y + r.d.y, s.toolpathOffset.z));
      },
      end: (moved, p) => {
        setAxis(null);
        if (moved) return useStore.getState().setIsToolpathDragging(false);
        if (!p) return;
        const q = bedToBoard(p, from, deg);
        const like = overlay.holdLike ?? holds[0];
        if (mode === 'add' && editable && sideA && like && onBoard(q, holdsOn, 40)) {
          apply?.(addHold(holds, like, q, holdsOn, bed.boardId));
          return say({ at: q, text: `${like.kind === 'clamp' ? 'Clamp' : 'Screw'} ${holds.length + 1} added`, tone: 'info' });
        }
        useBedEdit.getState().setSelected(pickAt(q, holds, parts));
      },
    });
  };

  // The selected item, and where its handle and bar go (board frame).
  const hold = selected?.kind === 'hold' ? holds[selected.i] : undefined;
  const part = selected?.kind === 'part' ? parts.find(p => p.id === selected.id) : undefined;
  const holdName = (i: number) => `${holds[i]?.kind === 'clamp' ? 'Clamp' : 'Screw'} ${i + 1}`;
  const name = hold && selected?.kind === 'hold' ? holdName(selected.i) : part?.name;
  const box = hold ? holdBox(hold) : part ? { x: part.x, y: part.y, w: part.w, h: part.h } : null;
  // Moved with the handle: the hold as placed there, or the part's spot.
  const movedHold = hold && item ? placeHold(hold, { x: hold.x + item.x, y: hold.y + item.y }, holdsOn) : undefined;
  const partAt = part && item ? { x: part.x + item.x, y: part.y + item.y, rotated: part.rotated } : undefined;
  const partStatus = part && partAt ? bed.check(part.id, partAt) : null;
  const holdHits = movedHold ? hitsPath(movedHold, deg, overlay.path, overlay.bit ?? 6, overlay.stockTop ?? 0) : false;
  const canMove = editable && (!!hold || !!part?.movable);
  const handleAt = box && { x: box.x + box.w + (hold ? 10 : -box.w / 2), y: box.y + box.h + (hold ? 10 : -box.h / 2) };

  const onHandleDown = (e: ThreeEvent<PointerEvent>) => {
    if (!selected) return;
    let lock: Axis = null;
    let d: P2 = { x: 0, y: 0 };
    drag(e, {
      move: (p, start, ev) => {
        const r = lockAxis({ x: p.x - start.x, y: p.y - start.y }, ev.shiftKey, lock);
        lock = r.axis;
        d = local(r.d);
        setItem(d);
      },
      end: moved => {
        setItem(null);
        if (!moved) return;
        if (hold && selected.kind === 'hold') {
          const to = { x: hold.x + d.x, y: hold.y + d.y };
          if (!onBoard(to, holdsOn, 40)) return say({ at: hold, text: `${holdName(selected.i)}: off the board`, tone: 'bad' });
          apply?.(moveHold(holds, selected.i, to, holdsOn, bed.boardId));
          say({ at: to, text: `${holdName(selected.i)} moved: planning again`, tone: 'info' });
        } else if (part) {
          const at = { x: part.x + d.x, y: part.y + d.y, rotated: part.rotated };
          const r = bed.drop(part.id, at);
          say(
            r === 'exact'
              ? { at, text: `${part.name} moved: planning again`, tone: 'info' }
              : r === 'moved'
                ? { at, text: `${part.name}: too close there, moved to the nearest free spot`, tone: 'warn' }
                : { at: part, text: `${part.name} doesn’t fit there`, tone: 'bad' }
          );
        }
      },
    });
  };

  // The turn knob, as in drawing tools: on a stalk above the middle of the top edge. The board turns about its middle,
  // so it stays where it lies; its XY zero follows.
  const mid = { x: overlay.w / 2, y: overlay.h / 2 };
  const knob = { x: mid.x, y: overlay.h + 24 };
  const onKnobDown = (e: ThreeEvent<PointerEvent>) => {
    const from = deg;
    const c = turn(mid, deg);
    const center = { x: offset.x + c.x, y: offset.y + c.y };
    let to = from;
    const show = (d: number) => {
      const m = useCamMachine.getState();
      if (m.overlay) m.setOverlay({ ...m.overlay, rotationDeg: d });
      const k = turn(mid, d);
      const s = useStore.getState();
      s.setToolpathOffset(new Vector3(center.x - k.x, center.y - k.y, s.toolpathOffset.z));
    };
    drag(e, {
      move: (p, _start, ev) => {
        const raw = (Math.atan2(p.y - center.y, p.x - center.x) * 180) / Math.PI - 90;
        // Shift: 15° steps.
        const d = ev.shiftKey ? snapAngle(Math.round(raw / 15) * 15) : snapAngle(raw);
        if (d === to) return;
        to = d;
        setTurning(d);
        show(d);
      },
      end: () => {
        setTurning(null);
        if (to !== from) bed.rotate(to, useStore.getState().toolpathOffset);
        else show(from);
      },
    });
  };

  return (
    <group rotation-z={(deg * Math.PI) / 180}>
      {/* The board, and a margin round it: a drag moves it, a tap selects. */}
      <mesh position={[overlay.w / 2, overlay.h / 2, kZ - 0.1]} onPointerDown={onBoardDown}>
        <planeGeometry args={[overlay.w + 40, overlay.h + 40]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>

      {/* The selected item: outlined, where the handle puts it while it's moved. */}
      {box && !item && (
        <Line points={rectLine({ x: box.x - 2, y: box.y - 2, w: box.w + 4, h: box.h + 4 }, kZ + 0.02)} color={kSelected} lineWidth={2.5} />
      )}
      {movedHold && <Line points={rectLine(holdBox(movedHold), kZ + 0.02)} color={holdHits ? kTone.bad : kSelected} lineWidth={2.5} />}
      {part && partAt && (
        <Line
          points={rectLine({ ...partAt, w: part.w, h: part.h }, kZ + 0.02)}
          color={partStatus === 'free' ? kSelected : partStatus === 'taken' ? kTone.warn : kTone.bad}
          lineWidth={2.5}
        />
      )}
      {movedHold && holdHits && <Note note={{ at: movedHold, text: 'The bit would hit it here', tone: 'bad' }} />}
      {partAt && partStatus === 'taken' && <Note note={{ at: partAt, text: 'Too close: goes to the nearest free spot', tone: 'warn' }} />}
      {partAt && partStatus === 'off' && <Note note={{ at: partAt, text: 'Off the board', tone: 'bad' }} />}

      {/* Its move handle: the one way to move it. */}
      {canMove && handleAt && (
        <group position={[handleAt.x + (item?.x ?? 0), handleAt.y + (item?.y ?? 0), kZ + 0.15]}>
          <mesh onPointerDown={onHandleDown}>
            <circleGeometry args={[9, 24]} />
            <meshBasicMaterial color={kSelected} depthWrite={false} />
          </mesh>
          <Html center style={{ pointerEvents: 'none' }} zIndexRange={[15, 0]}>
            <Move className="size-3.5 text-black" />
          </Html>
        </group>
      )}

      {/* Its bar: remove it, or change it in the CAM job. */}
      {selected && box && name && !item && (
        <CanvasLabel position={[box.x, box.y, 0.6]} offset={[0, 12]} maxWidth={384} interactive zIndexRange={[30, 0]}>
          <div
            role="toolbar"
            aria-label={name}
            onPointerDown={e => e.stopPropagation()}
            className="dark flex max-w-full flex-wrap items-center gap-0.5 rounded-md border bg-background/95 p-0.5 text-xs text-foreground shadow-md">
            <span className="px-1.5 font-medium">{name}</span>
            {hold && editable && selected.kind === 'hold' && (
              <button
                title="Remove it (Delete)"
                className="flex items-center gap-1 rounded px-1.5 py-1 hover:bg-muted"
                onClick={() => {
                  apply?.(removeHold(holds, selected.i, bed.boardId));
                  useBedEdit.getState().setSelected(null);
                }}>
                <Trash2 className="size-3.5" /> Remove
              </button>
            )}
            <button
              title="Change this board's layout, parts and holds in the CAM job's Boards step"
              className="flex items-center gap-1 rounded px-1.5 py-1 hover:bg-muted"
              onClick={() => bed.openInCam('layout')}>
              <Pencil className="size-3.5" /> Layout in CAM
            </button>
            <button
              title="Change this board's toolpaths in the CAM job's Plan step"
              className="flex items-center gap-1 rounded px-1.5 py-1 hover:bg-muted"
              onClick={() => bed.openInCam('toolpaths')}>
              <Pencil className="size-3.5" /> Toolpaths in CAM
            </button>
          </div>
        </CanvasLabel>
      )}

      {note && <Note note={note} />}
      {axis && <Note note={{ at: { x: 0, y: 0 }, text: `${axis.toUpperCase()} only (Shift)`, tone: 'info' }} />}

      {/* The turn knob. */}
      <Line
        points={[
          [mid.x, overlay.h, kZ],
          [knob.x, knob.y - 8, kZ],
        ]}
        color="#c4b5fd"
        lineWidth={1.5}
      />
      <mesh position={[knob.x, knob.y, kZ + 0.1]} onPointerDown={onKnobDown}>
        <circleGeometry args={[8, 24]} />
        <meshBasicMaterial color="#a78bfa" transparent opacity={turning !== null ? 1 : 0.85} depthWrite={false} />
      </mesh>
      <Note
        note={{
          at: { x: knob.x + 6, y: knob.y + 6 },
          text: turning !== null ? `${turning}°: the program follows` : `${deg}° · drag to turn`,
          tone: 'info',
        }}
      />
    </group>
  );
}
