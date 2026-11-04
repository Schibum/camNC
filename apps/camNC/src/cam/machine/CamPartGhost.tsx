import { useStore } from '@/store/store';
import { Line } from '@react-three/drei';
import { useMemo } from 'react';
import { BufferGeometry, Float32BufferAttribute, Path, Shape, Vector2 } from 'three';
import { useCamMachine, type BoardOverlay } from './camMachine';
import type { GhostPart } from './partGhost';

const kPart = '#ede9fe';
const kPocket = '#4c1d95';
const kPath = '#e5e7eb';
// Under the loaded program's toolpath (renderOrder -1) and everything else in the top view.
const kOrder = -2;
const kZ = 0.05;

/** How strongly the whole job shows: faint at rest, stronger while the board is dragged into place. */
const ghostStrength = (dragging: boolean) => (dragging ? 1 : 0.7);

type L3 = [number, number, number][];
const closed = (loop: [number, number][]): L3 => [...loop, loop[0]].map(([x, y]) => [x, y, kZ + 0.02]);

function PartShapes({ parts, strength }: { parts: GhostPart[]; strength: number }) {
  const { fills, pockets, edges, pocketEdges } = useMemo(() => {
    const v = (loop: [number, number][]) => loop.map(([x, y]) => new Vector2(x, y));
    const shape = (loop: [number, number][]) => new Shape(v(loop));
    const fills = parts.flatMap(p =>
      p.shapes.map(s => {
        const sh = shape(s.outline);
        sh.holes.push(...s.holes.map(h => new Path(v(h))));
        return sh;
      })
    );
    return {
      fills,
      pockets: parts.flatMap(p => p.pockets.map(shape)),
      edges: parts.flatMap(p => p.shapes.flatMap(s => [s.outline, ...s.holes])).map(closed),
      pocketEdges: parts.flatMap(p => p.pockets).map(closed),
    };
  }, [parts]);
  return (
    <group>
      {fills.length > 0 && (
        <mesh position-z={kZ} renderOrder={kOrder}>
          <shapeGeometry args={[fills, 4]} />
          <meshBasicMaterial color={kPart} transparent opacity={0.4 * strength} depthWrite={false} depthTest={false} />
        </mesh>
      )}
      {pockets.length > 0 && (
        <mesh position-z={kZ + 0.01} renderOrder={kOrder}>
          <shapeGeometry args={[pockets, 4]} />
          <meshBasicMaterial color={kPocket} transparent opacity={0.4 * strength} depthWrite={false} depthTest={false} />
        </mesh>
      )}
      {edges.map((pts, i) => (
        <Line
          key={`e${i}`}
          points={pts}
          color={kPart}
          lineWidth={1.25}
          transparent
          opacity={0.85 * strength}
          depthTest={false}
          renderOrder={kOrder}
        />
      ))}
      {pocketEdges.map((pts, i) => (
        <Line
          key={`p${i}`}
          points={pts}
          color={kPart}
          lineWidth={1}
          dashed
          dashSize={3}
          gapSize={2}
          transparent
          opacity={0.7 * strength}
          depthTest={false}
          renderOrder={kOrder}
        />
      ))}
    </group>
  );
}

/** Every program's cutting moves on this side, as one thin faint line set. */
function SidePath({ path, strength }: { path: NonNullable<BoardOverlay['path']>; strength: number }) {
  const geometry = useMemo(() => {
    const g = new BufferGeometry();
    const pos: number[] = [];
    for (const seg of path) for (let i = 1; i < seg.length; i++) pos.push(seg[i - 1][0], seg[i - 1][1], kZ, seg[i][0], seg[i][1], kZ);
    g.setAttribute('position', new Float32BufferAttribute(pos, 3));
    return g;
  }, [path]);
  return (
    <lineSegments geometry={geometry} renderOrder={kOrder}>
      <lineBasicMaterial color={kPath} transparent opacity={0.5 * strength} depthWrite={false} depthTest={false} />
    </lineSegments>
  );
}

/**
 * The rest of the job under the loaded program in the top view, so a program with little to line up against (a slot,
 * a few holes, side B) can still be placed: the parts as seen from above and, if chosen, every program on this side
 * of the board, faint. Stronger while the board is dragged into place; hidden while a program runs, unless every
 * program is asked for. Takes no pointer events: the holds and the move handle stay on top.
 */
export function CamPartGhost({ overlay, running }: { overlay: BoardOverlay; running: boolean }) {
  const show = useCamMachine(s => s.showInTopView);
  const dragging = useStore(s => s.isToolpathDragging);
  if (show === 'program' || (running && show !== 'all')) return null;
  const strength = ghostStrength(dragging);
  return (
    <group>
      {overlay.parts && <PartShapes parts={overlay.parts} strength={strength} />}
      {show === 'all' && overlay.path && <SidePath path={overlay.path} strength={strength} />}
    </group>
  );
}
