import { Html, Line } from '@react-three/drei';
import { useThree, type ThreeEvent } from '@react-three/fiber';
import { useEffect, useRef, useState } from 'react';
import { Plane, Vector3 } from 'three';
import type { PartPosition } from '../boards';
import { bedToBoard, lockAxis, nearestAxis, type Axis, snapAngle, turn, useBedEdit, type BedPart, type GhostBoard } from './bedEdit';
import { useStore } from '@/store/store';
import { useCamMachine, type BoardOverlay } from './camMachine';

type P2 = { x: number; y: number };

type Controls = { enabled: boolean } | null;

const kZ = 0.25;
const kTone = { free: '#22c55e', taken: '#f59e0b', off: '#ef4444' } as const;
const kGhost = '#94a3b8';

const rectLine = (r: { x: number; y: number; w: number; h: number }, z = kZ): [number, number, number][] => [
  [r.x, r.y, z],
  [r.x + r.w, r.y, z],
  [r.x + r.w, r.y + r.h, z],
  [r.x, r.y + r.h, z],
  [r.x, r.y, z],
];

/** Where a pointer's ray meets the board's top (the scene's z = 0 plane): the bed point it's over. */
function bedPoint(e: ThreeEvent<PointerEvent>): P2 | null {
  const hit = e.ray.intersectPlane(new Plane(new Vector3(0, 0, 1), 0), new Vector3());
  return hit ? { x: hit.x, y: hit.y } : null;
}

function Tag({ at, text, tone }: { at: P2; text: string; tone: string }) {
  return (
    <Html position={[at.x, at.y, 0.5]} style={{ pointerEvents: 'none' }} zIndexRange={[10, 0]}>
      <span
        style={{ background: tone }}
        className="ml-3 -mt-2.5 block w-max max-w-64 rounded px-1.5 py-0.5 text-xs font-medium text-black shadow-[0_1px_3px_rgba(0,0,0,0.6)]">
        {text}
      </span>
    </Html>
  );
}

/**
 * The board's parts in the top view (side A, board frame, turned with the outline), to drag to another spot while
 * nothing runs: green where the spot is free (it stays exactly there), amber where it's taken (it goes to the nearest
 * free spot), red off the board. R turns the part a quarter while dragging. And the knob that turns the board, about its middle.
 */
export function CamBedLayer({ overlay, offset, running }: { overlay: BoardOverlay; offset: P2; running: boolean }) {
  'use no memo';
  const bed = useBedEdit(s => s.bed);
  const mode = useBedEdit(s => s.mode);
  const controls = useThree(s => s.controls) as Controls;
  const camera = useThree(s => s.camera);
  const selected = useBedEdit(s => s.selected);
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
  // A part being dragged: where it'd land, and the pointer's offset from that corner (kept when R turns it).
  const [drag, setDrag] = useState<{ part: BedPart; start: P2; grab: P2; at: PartPosition; moved: boolean; axis?: Axis } | null>(null);
  const [turning, setTurning] = useState<{ from: number; deg: number; center: P2; offset: P2 } | null>(null);
  // The board itself being dragged: where the pointer and the board's XY zero were when it started.
  const [move, setMove] = useState<{ start: P2; from: P2; axis: Axis } | null>(null);
  const dragRef = useRef(drag);
  dragRef.current = drag;
  const deg = overlay.rotationDeg;
  const mine = !!bed && bed.boardId === overlay.boardId && !running;
  const movable = mine && !bed.locked && mode === 'move' && overlay.side !== 'b';

  // R while dragging: the part a quarter turn, about its middle.
  const dragOn = !!drag;
  useEffect(() => {
    if (!dragOn) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'r' && e.key !== 'R') return;
      e.preventDefault();
      const d = dragRef.current;
      if (!d) return;
      const [w, h] = d.at.rotated === d.part.rotated ? [d.part.w, d.part.h] : [d.part.h, d.part.w];
      const c = { x: d.at.x + w / 2, y: d.at.y + h / 2 };
      const at = { x: c.x - h / 2, y: c.y - w / 2, rotated: !d.at.rotated };
      const pointer = { x: d.at.x + d.grab.x, y: d.at.y + d.grab.y };
      setDrag({ ...d, moved: true, at, grab: { x: pointer.x - at.x, y: pointer.y - at.y } });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dragOn]);

  if (!bed || bed.boardId !== overlay.boardId) return null;
  const toBoard = (e: ThreeEvent<PointerEvent>) => {
    const p = bedPoint(e);
    return p && bedToBoard(p, offset, deg);
  };
  const size = (p: BedPart, rotated: boolean) => (rotated === p.rotated ? { w: p.w, h: p.h } : { w: p.h, h: p.w });
  const status = drag?.moved ? bed.check(drag.part.id, drag.at) : null;
  const release = (e: ThreeEvent<PointerEvent>) => {
    (e.target as Element | null)?.releasePointerCapture?.(e.pointerId);
    if (controls) controls.enabled = true;
  };

  // The turn knob, as in drawing tools: on a stalk above the middle of the top edge, turned with the board. The board
  // turns about its middle, so it stays where it lies; its XY zero follows.
  const mid = { x: overlay.w / 2, y: overlay.h / 2 };
  const knob = { x: mid.x, y: overlay.h + 24 };
  const turnTo = (e: ThreeEvent<PointerEvent>, t: { center: P2; from: number }) => {
    const p = bedPoint(e);
    if (!p) return null;
    const raw = (Math.atan2(p.y - t.center.y, p.x - t.center.x) * 180) / Math.PI - 90;
    // Shift: 15° steps.
    return e.shiftKey ? snapAngle(Math.round(raw / 15) * 15) : snapAngle(raw);
  };
  /** The board shown at `d`, turned about its middle `center` (machine X/Y). */
  const preview = (d: number, center: P2) => {
    const m = useCamMachine.getState();
    if (m.overlay) m.setOverlay({ ...m.overlay, rotationDeg: d });
    const c = turn(mid, d);
    const s = useStore.getState();
    s.setToolpathOffset(new Vector3(center.x - c.x, center.y - c.y, s.toolpathOffset.z));
  };

  const canMove = mine && mode === 'move';
  return (
    <group rotation-z={(deg * Math.PI) / 180}>
      {/* The board itself: dragged by any spot without a part or hold, it moves with its program. Shift: along X or Y. */}
      {canMove && (
        <mesh
          position={[overlay.w / 2, overlay.h / 2, kZ - 0.1]}
          onPointerDown={e => {
            const p = bedPoint(e);
            if (!p) return;
            e.stopPropagation();
            (e.target as Element | null)?.setPointerCapture?.(e.pointerId);
            if (controls) controls.enabled = false;
            setMove({ start: p, from: { x: offset.x, y: offset.y }, axis: null });
            useStore.getState().setIsToolpathDragging(true);
          }}
          onPointerMove={e => {
            if (!move) return;
            e.stopPropagation();
            const p = bedPoint(e);
            if (!p) return;
            const { d, axis } = lockAxis({ x: p.x - move.start.x, y: p.y - move.start.y }, e.shiftKey, move.axis);
            if (axis !== move.axis) setMove({ ...move, axis });
            const s = useStore.getState();
            s.setToolpathOffset(new Vector3(move.from.x + d.x, move.from.y + d.y, s.toolpathOffset.z));
          }}
          onPointerUp={e => {
            if (!move) return;
            e.stopPropagation();
            release(e);
            setMove(null);
            // A tap on the board, not a drag: nothing selected, the arrow keys move the board.
            if (Math.hypot(offset.x - move.from.x, offset.y - move.from.y) < 0.01) useBedEdit.getState().setSelected(null);
            useStore.getState().setIsToolpathDragging(false);
          }}>
          <planeGeometry args={[overlay.w + 40, overlay.h + 40]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} />
        </mesh>
      )}
      {overlay.side !== 'b' &&
        bed.parts
          .filter(p => p.movable)
          .map(p => {
            const dragged = drag?.part.id === p.id;
            return (
              <mesh
                key={p.id}
                position={[p.x + p.w / 2, p.y + p.h / 2, kZ - 0.05]}
                onPointerDown={e => {
                  if (!movable) return;
                  e.stopPropagation();
                  const at = toBoard(e);
                  if (!at) return;
                  (e.target as Element | null)?.setPointerCapture?.(e.pointerId);
                  if (controls) controls.enabled = false;
                  setDrag({
                    part: p,
                    start: at,
                    grab: { x: at.x - p.x, y: at.y - p.y },
                    at: { x: p.x, y: p.y, rotated: p.rotated },
                    moved: false,
                  });
                }}
                onPointerMove={e => {
                  if (!dragged || !drag) return;
                  e.stopPropagation();
                  const at = toBoard(e);
                  if (!at) return;
                  const moved = drag.moved || Math.hypot(at.x - drag.start.x, at.y - drag.start.y) > 1;
                  const { d, axis } = lockAxis({ x: at.x - drag.start.x, y: at.y - drag.start.y }, e.shiftKey, drag.axis ?? null);
                  const to = { x: drag.start.x + d.x - drag.grab.x, y: drag.start.y + d.y - drag.grab.y };
                  setDrag({ ...drag, moved, axis, at: { ...to, rotated: drag.at.rotated } });
                }}
                onPointerUp={e => {
                  if (!dragged || !drag) return;
                  e.stopPropagation();
                  release(e);
                  setDrag(null);
                  if (drag.moved && status !== 'off') bed.drop(p.id, drag.at);
                  // A tap: the part is selected, for the arrow keys.
                  if (!drag.moved) useBedEdit.getState().setSelected({ kind: 'part', id: p.id });
                }}>
                <planeGeometry args={[p.w, p.h]} />
                <meshBasicMaterial color="#a78bfa" transparent opacity={dragged ? 0.04 : movable ? 0.1 : 0} depthWrite={false} />
              </mesh>
            );
          })}
      {drag?.moved && status && (
        <>
          <Line points={rectLine({ ...drag.at, ...size(drag.part, drag.at.rotated) }, kZ + 0.02)} color={kTone[status]} lineWidth={2.5} />
          <Tag
            at={{ x: drag.at.x, y: drag.at.y + size(drag.part, drag.at.rotated).h }}
            tone={kTone[status]}
            text={
              status === 'free'
                ? `${drag.part.name}: stays here`
                : status === 'taken'
                  ? `${drag.part.name}: too close, goes to the nearest free spot`
                  : `${drag.part.name}: off the board`
            }
          />
        </>
      )}
      {selected?.kind === 'part' &&
        bed.parts
          .filter(p => p.id === selected.id)
          .map(p => <Line key={p.id} points={rectLine(p, kZ + 0.01)} color="#fbbf24" lineWidth={2.5} />)}
      {move?.axis && <Tag at={{ x: 0, y: 0 }} tone="#c4b5fd" text={`${move.axis.toUpperCase()} only (Shift)`} />}
      {drag?.axis && (
        <Tag at={{ x: drag.at.x, y: drag.at.y }} tone="#c4b5fd" text={`Along the board's ${drag.axis.toUpperCase()} only (Shift)`} />
      )}
      {mine && (
        <>
          <Line
            points={[
              [mid.x, overlay.h, kZ],
              [knob.x, knob.y - 8, kZ],
            ]}
            color="#c4b5fd"
            lineWidth={1.5}
          />
          <mesh
            position={[knob.x, knob.y, kZ + 0.1]}
            onPointerDown={e => {
              e.stopPropagation();
              (e.target as Element | null)?.setPointerCapture?.(e.pointerId);
              if (controls) controls.enabled = false;
              const c = turn(mid, deg);
              setTurning({ from: deg, deg, center: { x: offset.x + c.x, y: offset.y + c.y }, offset });
            }}
            onPointerMove={e => {
              if (!turning) return;
              e.stopPropagation();
              const d = turnTo(e, turning);
              if (d === null || d === turning.deg) return;
              setTurning({ ...turning, deg: d });
              preview(d, turning.center);
            }}
            onPointerUp={e => {
              if (!turning) return;
              e.stopPropagation();
              release(e);
              const t = turning;
              setTurning(null);
              if (t.deg !== t.from) bed.rotate(t.deg, useStore.getState().toolpathOffset);
              else preview(t.from, t.center);
            }}>
            <circleGeometry args={[8, 24]} />
            <meshBasicMaterial color="#a78bfa" transparent opacity={turning ? 1 : 0.85} depthWrite={false} />
          </mesh>
          <Tag
            at={{ x: knob.x + 6, y: knob.y + 6 }}
            tone="#c4b5fd"
            text={turning ? `${turning.deg}°: the program follows` : `${deg}° · drag to turn`}
          />
        </>
      )}
    </group>
  );
}

/**
 * The job's other boards where they were placed on the bed: faint outlines, so the whole bed shows what goes where. A
 * tap loads that board's next program (not while one runs).
 */
export function CamGhostBoards({ running }: { running: boolean }) {
  const bed = useBedEdit(s => s.bed);
  if (!bed?.ghosts.length) return null;
  return (
    <>
      {bed.ghosts.map((g: GhostBoard) => (
        <group key={g.id} position={[g.x, g.y, 0]} rotation-z={(g.deg * Math.PI) / 180}>
          <Line points={rectLine({ x: 0, y: 0, w: g.w, h: g.h }, 0.1)} color={kGhost} lineWidth={1.5} dashed dashSize={4} gapSize={4} />
          <mesh
            position={[g.w / 2, g.h / 2, 0.05]}
            onClick={e => {
              if (running) return;
              e.stopPropagation();
              bed.show(g.id);
            }}>
            <planeGeometry args={[g.w, g.h]} />
            <meshBasicMaterial color={kGhost} transparent opacity={0.08} depthWrite={false} />
          </mesh>
          <Html position={[0, g.h, 0.4]} style={{ pointerEvents: 'none' }} zIndexRange={[10, 0]}>
            <span className="ml-1 -mt-6 block w-max rounded bg-slate-300/90 px-1.5 py-0.5 text-xs font-medium text-black">
              Board {g.name}
              {g.cut ? ' · cut' : running ? '' : ' · tap to show'}
            </span>
          </Html>
        </group>
      ))}
    </>
  );
}
