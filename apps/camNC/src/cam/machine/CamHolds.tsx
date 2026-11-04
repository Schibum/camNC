import { Html, Line } from '@react-three/drei';
import { useThree, type ThreeEvent } from '@react-three/fiber';
import { holdBox, pathClearance } from '@wbcnc/cam/holdPoints';
import { useRef, useState } from 'react';
import { Plane, Vector3 } from 'three';
import { addHold, bedToBoard, hitsPath, moveHold, onBoard, placeHold, removeHold, useBedEdit } from './bedEdit';
import type { BoardOverlay } from './camMachine';

const kHold = '#38bdf8';
const kClash = '#ef4444';
const kZ = 0.35;

type P2 = { x: number; y: number };
type Controls = { enabled: boolean } | null;

/** A rectangle as a closed line, board frame. */
const rectLine = (r: { x: number; y: number; w: number; h: number }): [number, number, number][] => [
  [r.x, r.y, kZ],
  [r.x + r.w, r.y, kZ],
  [r.x + r.w, r.y + r.h, kZ],
  [r.x, r.y + r.h, kZ],
  [r.x, r.y, kZ],
];

/** A circle as a closed line, board frame. */
const circleLine = (c: P2, r: number): [number, number, number][] =>
  Array.from({ length: 33 }, (_, i) => [c.x + r * Math.cos((i / 32) * 2 * Math.PI), c.y + r * Math.sin((i / 32) * 2 * Math.PI), kZ]);

/** Where a pointer's ray meets the board's top (the scene's z = 0 plane): the bed point it's over. */
function bedPoint(e: ThreeEvent<PointerEvent>): P2 | null {
  const hit = e.ray.intersectPlane(new Plane(new Vector3(0, 0, 1), 0), new Vector3());
  return hit ? { x: hit.x, y: hit.y } : null;
}

/**
 * The board's screws and clamps in the top view, turned with the outline: the footprint, and dashed where the bit's cut
 * stays clear of it. Red where the program's bit would hit one. While nothing runs they can be moved (drag), added
 * (Add mode, tap the board) and removed (Remove mode, tap one): the job is saved and planned again, and the program
 * that's loaded follows.
 */
export function CamHolds({ overlay, offset, running }: { overlay: BoardOverlay; offset: P2; running: boolean }) {
  'use no memo';
  const { mode, apply } = useBedEdit();
  const controls = useThree(s => s.controls) as Controls;
  const [drag, setDrag] = useState<{ i: number; at: P2; moved: boolean } | null>(null);
  const start = useRef<P2 | null>(null);
  const holds = overlay.holds;
  if (!holds || overlay.side === 'b' || !overlay.boardId) return null;
  const board = overlay.holdsOn ?? { w: overlay.w, h: overlay.h };
  const deg = overlay.rotationDeg;
  const editable = !running && !!apply;
  const r = (overlay.bit ?? 6) / 2;
  const clash = new Set((overlay.holdClash ?? []).map(p => `${Math.round(p.x * 10)},${Math.round(p.y * 10)}`));
  const isClash = (h: P2) => clash.has(`${Math.round(h.x * 10)},${Math.round(h.y * 10)}`);
  const toBoard = (e: ThreeEvent<PointerEvent>) => {
    const p = bedPoint(e);
    return p && bedToBoard(p, offset, deg);
  };
  const like = overlay.holdLike ?? holds[0];

  const shown = holds.map((h, i) => (drag?.i === i ? placeHold(h, drag.at, board) : h));
  const live = drag && drag.moved ? hitsPath(shown[drag.i], deg, overlay.path, overlay.bit ?? 6, overlay.stockTop ?? 0) : false;

  const endDrag = (e: ThreeEvent<PointerEvent>) => {
    if (!drag) return;
    (e.target as Element | null)?.releasePointerCapture?.(e.pointerId);
    if (controls) controls.enabled = true;
    const d = drag;
    setDrag(null);
    if (d.moved && onBoard(d.at, board, 40)) apply?.(moveHold(holds, d.i, d.at, board, overlay.boardId!));
  };

  return (
    <group rotation-z={(deg * Math.PI) / 180}>
      {/* Add mode: a tap on the board (or just past its edge, for a clamp) puts a hold there. */}
      {editable && mode === 'add' && like && (
        <mesh
          position={[board.w / 2, board.h / 2, kZ - 0.05]}
          onClick={e => {
            e.stopPropagation();
            const p = bedToBoard({ x: e.point.x, y: e.point.y }, offset, deg);
            if (onBoard(p, board, 40)) apply?.(addHold(holds, like, p, board, overlay.boardId!));
          }}>
          <planeGeometry args={[board.w + 80, board.h + 80]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} />
        </mesh>
      )}
      {shown.map((h, i) => {
        const box = holdBox(h);
        const keep = pathClearance(h, r) - r;
        const halo = { x: box.x - keep, y: box.y - keep, w: box.w + 2 * keep, h: box.h + 2 * keep };
        const bad = drag?.i === i ? live : isClash(holds[i]);
        const color = bad ? kClash : kHold;
        const clamp = h.kind === 'clamp' && h.w !== undefined;
        const name = `${clamp ? 'Clamp' : 'Screw'} ${i + 1}`;
        return (
          <group key={i}>
            {clamp ? (
              <Line points={rectLine(halo)} color={color} lineWidth={1.5} dashed dashSize={3} gapSize={3} />
            ) : (
              <Line points={circleLine(h, h.d / 2 + keep)} color={color} lineWidth={1.5} dashed dashSize={3} gapSize={3} />
            )}
            <mesh
              position={[box.x + box.w / 2, box.y + box.h / 2, kZ]}
              userData={{ hold: i }}
              onPointerDown={e => {
                if (!editable || mode !== 'move') return;
                e.stopPropagation();
                (e.target as Element | null)?.setPointerCapture?.(e.pointerId);
                if (controls) controls.enabled = false;
                start.current = bedPoint(e);
                setDrag({ i, at: { x: h.x, y: h.y }, moved: false });
              }}
              onPointerMove={e => {
                if (drag?.i !== i) return;
                e.stopPropagation();
                const p = toBoard(e);
                const s = start.current;
                const b = bedPoint(e);
                const moved = drag.moved || (!!s && !!b && Math.hypot(b.x - s.x, b.y - s.y) > 1);
                if (p) setDrag({ i, at: p, moved });
              }}
              onPointerUp={endDrag}
              onClick={e => {
                if (!editable || mode !== 'remove') return;
                e.stopPropagation();
                apply?.(removeHold(holds, i, board, overlay.boardId!));
              }}>
              {clamp ? (
                <planeGeometry args={[Math.max(box.w, 8), Math.max(box.h, 8)]} />
              ) : (
                <circleGeometry args={[Math.max(h.d / 2, 4), 24]} />
              )}
              <meshBasicMaterial color={color} transparent opacity={drag?.i === i ? 0.9 : 0.6} depthWrite={false} />
            </mesh>
            {(drag?.i === i || bad) && (
              <Html position={[h.x, h.y, 0.5]} style={{ pointerEvents: 'none' }} zIndexRange={[10, 0]}>
                <span
                  className={`ml-4 -mt-2.5 block w-max rounded px-1.5 py-0.5 text-xs font-medium shadow-[0_1px_3px_rgba(0,0,0,0.6)] ${bad ? 'bg-red-500 text-white' : 'bg-sky-400 text-black'}`}>
                  {bad ? `${name}: the bit would hit it` : name}
                </span>
              </Html>
            )}
          </group>
        );
      })}
    </group>
  );
}
