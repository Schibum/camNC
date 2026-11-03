/** THROWAWAY concept B: "Toolpath layers" — every op's toolpath as colored 3D lines at real Z, over a ghost stock + part. */
import { Line, OrbitControls, OrthographicCamera, PerspectiveCamera } from '@react-three/drei';
import { Canvas, useThree } from '@react-three/fiber';
import { Button } from '@wbcnc/ui/components/button';
import { cn } from '@wbcnc/ui/lib/utils';
import { Eye, EyeOff } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Box3, Path, Shape, Vector3 } from 'three';
import { isRapidSegment } from '@/visualize/depthInspection';
import { kDefaultPlan } from '../planSettings';
import type { PocBoard, PocOp } from './usePocBoard';

const kPalette = ['#f97316', '#3b82f6', '#22c55e', '#e11d48', '#a855f7', '#eab308', '#06b6d4', '#ec4899', '#84cc16', '#6366f1'];

type V3 = [number, number, number];

interface OpGeom {
  cuts: V3[];
  rapids: V3[];
  zLevels: number[];
}

/** Split an op's point range into cut and rapid segment pairs (for <Line segments>). */
function opGeometry(board: PocBoard, op: PocOp): OpGeom {
  const { pathPoints } = board.toolpath;
  const cuts: V3[] = [];
  const rapids: V3[] = [];
  const zs = new Set<number>();
  for (let i = Math.max(1, op.from); i <= op.to; i++) {
    const a = pathPoints[i - 1];
    const b = pathPoints[i];
    if (a.equals(b)) continue;
    const target = isRapidSegment(board.toolpath, i) ? rapids : cuts;
    target.push([a.x, a.y, a.z], [b.x, b.y, b.z]);
    if (target === cuts && Math.abs(a.z - b.z) < 1e-3) zs.add(Math.round(a.z * 10) / 10);
  }
  return { cuts, rapids, zLevels: [...zs].sort((x, y) => y - x) };
}

/** Ghost of the finished part, placed by aligning its bbox to the final outline pass (minus the bit radius). */
function PartGhost({ board, ops }: { board: PocBoard; ops: OpGeom[] }) {
  const placed = useMemo(() => {
    const { outlines, holes, pockets } = board.part.shape;
    if (!outlines.length) return null;
    const lastProfile = [...board.ops].reverse().find(o => o.kind === 'profile');
    const geom = lastProfile ? ops[lastProfile.index] : null;
    if (!geom || geom.cuts.length < 2) return null;
    const cut = new Box3().setFromPoints(geom.cuts.map(p => new Vector3(...p)));
    const r = kDefaultPlan.bit.diameter / 2;
    const tw = cut.max.x - cut.min.x - 2 * r;
    const th = cut.max.y - cut.min.y - 2 * r;
    const all = outlines.flat();
    const minX = Math.min(...all.map(p => p[0]));
    const minY = Math.min(...all.map(p => p[1]));
    const w = Math.max(...all.map(p => p[0])) - minX;
    const h = Math.max(...all.map(p => p[1])) - minY;
    // Nesting may have turned the part a quarter turn.
    const rotated = Math.abs(w - th) + Math.abs(h - tw) < Math.abs(w - tw) + Math.abs(h - th);
    const map = ([x, y]: [number, number]): [number, number] =>
      rotated ? [cut.min.x + r + (h - (y - minY)), cut.min.y + r + (x - minX)] : [cut.min.x + r + (x - minX), cut.min.y + r + (y - minY)];
    const toShape = (loop: [number, number][]) => new Shape(loop.map(map).map(([x, y]) => ({ x, y }) as never));
    const shapes = outlines.map(toShape);
    for (const hole of holes) shapes[0]?.holes.push(new Path(hole.map(map).map(([x, y]) => ({ x, y }) as never)));
    const pocketShapes = pockets.flatMap(p => p.region.map(loop => ({ depth: p.depth, shape: toShape(loop) })));
    return { shapes, pocketShapes };
  }, [board, ops]);
  if (!placed) return null;
  const top = board.size[2];
  const t = board.part.thickness;
  return (
    <group position-z={top - t}>
      <mesh renderOrder={1}>
        <extrudeGeometry args={[placed.shapes, { depth: t, bevelEnabled: false }]} />
        <meshStandardMaterial color="#d6b98c" transparent opacity={0.22} depthWrite={false} />
      </mesh>
      {placed.pocketShapes.map((p, i) => (
        <mesh key={i} position-z={t - p.depth + 0.02} renderOrder={2}>
          <shapeGeometry args={[p.shape]} />
          <meshBasicMaterial color="#7c5a2b" transparent opacity={0.25} depthWrite={false} />
        </mesh>
      ))}
    </group>
  );
}

function Stock({ size }: { size: [number, number, number] }) {
  const [w, h, t] = size;
  return (
    <group position={[w / 2, h / 2, t / 2]}>
      <mesh renderOrder={0}>
        <boxGeometry args={[w, h, t]} />
        <meshStandardMaterial color="#c8a978" transparent opacity={0.08} depthWrite={false} />
      </mesh>
      <Line
        points={[
          [-w / 2, -h / 2, t / 2],
          [w / 2, -h / 2, t / 2],
          [w / 2, h / 2, t / 2],
          [-w / 2, h / 2, t / 2],
          [-w / 2, -h / 2, t / 2],
        ]}
        color="#a1855a"
        lineWidth={1}
        transparent
        opacity={0.6}
      />
      <Line
        points={[
          [-w / 2, -h / 2, -t / 2],
          [w / 2, -h / 2, -t / 2],
          [w / 2, h / 2, -t / 2],
          [-w / 2, h / 2, -t / 2],
          [-w / 2, -h / 2, -t / 2],
        ]}
        color="#a1855a"
        lineWidth={1}
        transparent
        opacity={0.3}
      />
    </group>
  );
}

type CamMode = '3d' | 'top';

function Scene({
  board,
  geoms,
  visible,
  isolated,
  showRapids,
  mode,
}: {
  board: PocBoard;
  geoms: OpGeom[];
  visible: boolean[];
  isolated: number | null;
  showRapids: boolean;
  mode: CamMode;
}) {
  const [w, h, t] = board.size;
  // Frame the isolated op (with some context), or the whole board.
  const focus = useMemo(() => {
    const pts = isolated !== null ? geoms[isolated].cuts : [];
    if (pts.length < 2) return { center: [w / 2, h / 2, t / 2] as V3, span: Math.max(w, h * 1.6), key: 'all' };
    const b = new Box3().setFromPoints(pts.map(p => new Vector3(...p)));
    const c = b.getCenter(new Vector3());
    return { center: [c.x, c.y, c.z] as V3, span: Math.max(b.max.x - b.min.x, (b.max.y - b.min.y) * 1.6, 60) * 1.3, key: `op${isolated}` };
  }, [isolated, geoms, w, h, t]);
  const { center, span } = focus;
  const far = Math.max(w, h) * 20;
  return (
    <>
      {mode === '3d' ? (
        <PerspectiveCamera
          key={`p-${focus.key}`}
          makeDefault
          up={[0, 0, 1]}
          fov={35}
          position={[center[0] - span * 0.2, center[1] - span * 0.9, center[2] + span * 0.9]}
          near={0.5}
          far={far}
        />
      ) : (
        <OrthographicCamera
          key={`o-${focus.key}`}
          makeDefault
          up={[0, 1, 0]}
          position={[center[0], center[1], t + span * 2]}
          zoom={1}
          near={0.5}
          far={far}
        />
      )}
      <OrbitControls
        key={`${mode}-${focus.key}`}
        makeDefault
        target={center}
        enableRotate={mode === '3d'}
        enableDamping
        dampingFactor={0.15}
      />
      {mode === 'top' && <TopZoom key={focus.key} span={span / 1.3} />}
      <ambientLight intensity={0.8} />
      <directionalLight position={[w, -h, span]} intensity={1.2} />
      <Stock size={board.size} />
      <PartGhost board={board} ops={geoms} />
      {board.ops.map((op, i) => {
        if (!visible[i]) return null;
        const dim = isolated !== null && isolated !== i;
        const g = geoms[i];
        const color = kPalette[i % kPalette.length];
        return (
          <group key={op.index}>
            {g.cuts.length > 1 && (
              <Line segments points={g.cuts} color={color} lineWidth={dim ? 1 : 2} transparent opacity={dim ? 0.1 : 1} depthWrite={!dim} />
            )}
            {showRapids && !dim && g.rapids.length > 1 && (
              <Line segments points={g.rapids} color="#64748b" lineWidth={1} dashed dashSize={3} gapSize={3} transparent opacity={0.45} />
            )}
          </group>
        );
      })}
      <axesHelper args={[span * 0.08]} />
    </>
  );
}

/** Orthographic zoom so the board fills the view in top mode. */
function TopZoom({ span }: { span: number }) {
  const camera = useThree(s => s.camera);
  const size = useThree(s => s.size);
  useEffect(() => {
    if ('isOrthographicCamera' in camera) {
      camera.zoom = (Math.min(size.width, size.height) / span) * 0.9;
      camera.updateProjectionMatrix();
    }
  }, [camera, size, span]);
  return null;
}

export function VariantB({ board }: { board: PocBoard }) {
  const geoms = useMemo(() => board.ops.map(op => opGeometry(board, op)), [board]);
  const [visible, setVisible] = useState<boolean[]>(() => board.ops.map(() => true));
  const [isolated, setIsolated] = useState<number | null>(null);
  const [showRapids, setShowRapids] = useState(true);
  const [mode, setMode] = useState<CamMode>('3d');
  const vis = board.ops.map((_, i) => visible[i] ?? true);

  return (
    <div className="flex min-h-0 flex-1">
      <aside className="flex w-80 shrink-0 flex-col gap-2 overflow-y-auto border-r p-3 text-sm">
        <div className="flex items-center justify-between">
          <h2 className="font-medium">Operations</h2>
          {isolated !== null && (
            <button className="text-xs text-muted-foreground underline" onClick={() => setIsolated(null)}>
              show all
            </button>
          )}
        </div>
        <ol className="flex flex-col gap-1" data-testid="op-list">
          {board.ops.map((op, i) => {
            const g = geoms[i];
            const passes = g.zLevels.length;
            return (
              <li
                key={op.index}
                data-testid={`op-${i}`}
                onClick={() => setIsolated(isolated === i ? null : i)}
                className={cn(
                  'flex cursor-pointer items-center gap-2 rounded-md border px-2 py-1.5 hover:bg-muted',
                  isolated === i && 'border-primary bg-muted',
                  isolated !== null && isolated !== i && 'opacity-50'
                )}>
                <span className="size-3 shrink-0 rounded-sm" style={{ background: kPalette[i % kPalette.length] }} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate">
                    {i + 1}. {op.label}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {passes} {passes === 1 ? 'pass' : 'passes'}
                    {passes > 0 && ` · z ${g.zLevels[0]}…${g.zLevels[passes - 1]}`}
                  </span>
                </span>
                <button
                  aria-label={vis[i] ? 'Hide' : 'Show'}
                  className="rounded p-1 text-muted-foreground hover:bg-background"
                  onClick={e => {
                    e.stopPropagation();
                    setVisible(vis.map((v, k) => (k === i ? !v : v)));
                  }}>
                  {vis[i] ? <Eye className="size-4" /> : <EyeOff className="size-4" />}
                </button>
              </li>
            );
          })}
        </ol>
        <label className="mt-2 flex items-center gap-2 text-xs">
          <input type="checkbox" checked={showRapids} onChange={e => setShowRapids(e.target.checked)} /> Show rapids (dashed)
        </label>
        <p className="text-xs text-muted-foreground">
          Board {board.size[0].toFixed(0)} × {board.size[1].toFixed(0)} × {board.size[2].toFixed(1)} mm. Click an operation to isolate it.
        </p>
      </aside>
      <div className="relative min-w-0 flex-1 bg-neutral-100 dark:bg-neutral-900">
        <div className="absolute top-3 right-3 z-10 flex gap-1 rounded-md border bg-background p-1">
          {(['3d', 'top'] as const).map(m => (
            <Button key={m} size="sm" variant={mode === m ? 'default' : 'ghost'} onClick={() => setMode(m)}>
              {m === '3d' ? '3D' : 'Top'}
            </Button>
          ))}
        </div>
        <Canvas className="absolute! inset-0">
          <Scene board={board} geoms={geoms} visible={vis} isolated={isolated} showRapids={showRapids} mode={mode} />
        </Canvas>
      </div>
    </div>
  );
}
