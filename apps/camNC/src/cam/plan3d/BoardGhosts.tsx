import { Edges, Line } from '@react-three/drei';
import { useMemo } from 'react';
import { Path, Shape, Vector2 } from 'three';
import type { BoardRequest, CamPartInfo, Outline2D } from '../camTypes';
import { kStockColor } from './palette';

const kPartColor = '#e7d3b0';

function inside([x, y]: [number, number], loop: [number, number][]) {
  let hit = false;
  for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
    const [xi, yi] = loop[i];
    const [xj, yj] = loop[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

/** The finished parts at their nested positions: outlines with their holes, and the pocket floors. */
function useParts(board: BoardRequest, parts: CamPartInfo[]) {
  return useMemo(() => {
    const byId = new Map(parts.map(p => [p.id, p]));
    return board.parts.flatMap(placed => {
      const part = byId.get(placed.partId);
      if (!part) return [];
      // Part frame -> board frame, as in @wbcnc/cam partToBoard.
      const f = ([x, y]: [number, number]) =>
        placed.rotated ? new Vector2(placed.x + part.size[1] - y, placed.y + x) : new Vector2(placed.x + x, placed.y + y);
      const shapes = part.shape.outlines.map(loop => ({ loop, shape: new Shape(loop.map(f)) }));
      for (const hole of part.shape.holes) {
        const owner = shapes.find(s => hole.length && inside(hole[0], s.loop)) ?? shapes[0];
        owner?.shape.holes.push(new Path(hole.map(f)));
      }
      const loops = (o: Outline2D) => o.map(loop => new Shape(loop.map(f)));
      return [
        {
          key: placed.id,
          thickness: part.thickness,
          shapes: shapes.map(s => s.shape),
          pockets: part.shape.pockets.map(p => ({ depth: p.depth, shapes: loops(p.region) })),
        },
      ];
    });
  }, [board, parts]);
}

/** Ghost of the finished parts, for the see-through view: faint solid with crisp edges. */
export function PartGhost({ board, parts }: { board: BoardRequest; parts: CamPartInfo[] }) {
  const placed = useParts(board, parts);
  return (
    <group>
      {placed.map(p => (
        <group key={p.key}>
          <mesh renderOrder={2}>
            <extrudeGeometry args={[p.shapes, { depth: p.thickness, bevelEnabled: false, curveSegments: 4 }]} />
            <meshStandardMaterial color={kPartColor} transparent opacity={0.16} depthWrite={false} />
            <Edges threshold={20} color={kPartColor} transparent opacity={0.7} />
          </mesh>
          {p.pockets.map((pk, i) => (
            <mesh key={i} position-z={p.thickness - pk.depth + 0.02} renderOrder={2}>
              <shapeGeometry args={[pk.shapes]} />
              <meshBasicMaterial color={kPartColor} transparent opacity={0.22} depthWrite={false} />
            </mesh>
          ))}
        </group>
      ))}
    </group>
  );
}

/** The uncut stock as a faint box, for the see-through toolpath view. */
export function StockBox({ size }: { size: [number, number, number] }) {
  const [w, h, t] = size;
  const rect = (z: number): [number, number, number][] => [
    [0, 0, z],
    [w, 0, z],
    [w, h, z],
    [0, h, z],
    [0, 0, z],
  ];
  return (
    <group>
      <mesh position={[w / 2, h / 2, t / 2]} renderOrder={1}>
        <boxGeometry args={[w, h, t]} />
        <meshStandardMaterial color={kStockColor} transparent opacity={0.1} depthWrite={false} />
      </mesh>
      <Line points={rect(t)} color={kStockColor} lineWidth={1} transparent opacity={0.7} />
      <Line points={rect(0)} color={kStockColor} lineWidth={1} transparent opacity={0.35} />
    </group>
  );
}
