import { Line } from '@react-three/drei';
import { CanvasLabel } from '@/scene/CanvasLabel';
import { holdBox, pathClearance } from '@wbcnc/cam/holdPoints';
import { useBedEdit } from './bedEdit';
import type { BoardOverlay } from './camMachine';

const kHold = '#38bdf8';
const kClash = '#ef4444';
const kZ = 0.35;

type P2 = { x: number; y: number };

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

/**
 * The board's screws and clamps in the top view, turned with the outline: the footprint, and dashed where the bit's cut
 * stays clear of it. Red where the program's bit would hit one, amber when selected. Selecting, moving, adding and
 * removing them is `CamBedLayer`'s.
 */
export function CamHolds({ overlay }: { overlay: BoardOverlay }) {
  const selected = useBedEdit(s => s.selected);
  const holds = overlay.holds;
  if (!holds || overlay.side === 'b' || !overlay.boardId) return null;
  const deg = overlay.rotationDeg;
  const r = (overlay.bit ?? 6) / 2;
  const clash = new Set((overlay.holdClash ?? []).map(p => `${Math.round(p.x * 10)},${Math.round(p.y * 10)}`));
  const isClash = (h: P2) => clash.has(`${Math.round(h.x * 10)},${Math.round(h.y * 10)}`);
  return (
    <group rotation-z={(deg * Math.PI) / 180}>
      {holds.map((h, i) => {
        const box = holdBox(h);
        const keep = pathClearance(h, r) - r;
        const halo = { x: box.x - keep, y: box.y - keep, w: box.w + 2 * keep, h: box.h + 2 * keep };
        const bad = isClash(h);
        const color = bad ? kClash : selected?.kind === 'hold' && selected.i === i ? '#fbbf24' : kHold;
        const clamp = h.kind === 'clamp' && h.w !== undefined;
        return (
          <group key={i}>
            {clamp ? (
              <Line points={rectLine(halo)} color={color} lineWidth={1.5} dashed dashSize={3} gapSize={3} />
            ) : (
              <Line points={circleLine(h, h.d / 2 + keep)} color={color} lineWidth={1.5} dashed dashSize={3} gapSize={3} />
            )}
            <mesh position={[box.x + box.w / 2, box.y + box.h / 2, kZ]}>
              {clamp ? (
                <planeGeometry args={[Math.max(box.w, 8), Math.max(box.h, 8)]} />
              ) : (
                <circleGeometry args={[Math.max(h.d / 2, 4), 24]} />
              )}
              <meshBasicMaterial color={color} transparent opacity={0.6} depthWrite={false} />
            </mesh>
            {bad && (
              <CanvasLabel position={[h.x, h.y, 0.5]} offset={[16, -10]}>
                <span className="block max-w-full rounded bg-red-500 px-1.5 py-0.5 text-xs font-medium text-white shadow-[0_1px_3px_rgba(0,0,0,0.6)]">
                  {`${clamp ? 'Clamp' : 'Screw'} ${i + 1}: the bit would hit it`}
                </span>
              </CanvasLabel>
            )}
          </group>
        );
      })}
    </group>
  );
}
