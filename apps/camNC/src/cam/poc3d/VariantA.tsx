/**
 * THROWAWAY concept A "Simulation first": the board as simulated stock up to a playhead, a timeline under it and the
 * operations on the side. Selecting an operation colors the material it removes and shows only its toolpath.
 */
import { OrbitControls } from '@react-three/drei';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Button } from '@wbcnc/ui/components/button';
import { cn } from '@wbcnc/ui/lib/utils';
import { Pause, Play } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Box2, Box3, Color, PerspectiveCamera, Vector2, Vector3 } from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { HeightmapStamper, heightmapSize } from '@/visualize/stockSim/HeightmapStamper';
import { formatDuration, getJobTimeline, playheadAt, type Playhead } from '@/visualize/stockSim/jobTimeline';
import { kDefaultPlan } from '../planSettings';
import type { PocBoard, PocOp } from './usePocBoard';
import { OpLines, StockMesh } from './variantAScene';

const kMaxHeightmap = 2048;
const kOpColors = ['#8b5cf6', '#f97316', '#10b981', '#ec4899', '#0ea5e9', '#eab308', '#ef4444', '#14b8a6'];
const opColor = (i: number) => kOpColors[i % kOpColors.length];

type View = '3d' | 'top';

export function VariantA({ board }: { board: PocBoard }) {
  const { toolpath, ops } = board;
  const timeline = useMemo(() => getJobTimeline(toolpath), [toolpath]);
  const opTimes = useMemo(
    () => ops.map(o => ({ start: timeline.times[o.from] ?? 0, end: timeline.times[o.to] ?? timeline.total })),
    [ops, timeline]
  );
  const [time, setTime] = useState(timeline.total);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(20);
  const [selected, setSelected] = useState<number | null>(null);
  const [view, setView] = useState<View>('3d');

  // Play: advance the time with the wall clock.
  useEffect(() => {
    if (!playing) return;
    let last = performance.now();
    let raf = requestAnimationFrame(function tick(now) {
      const dt = (now - last) / 1000;
      last = now;
      setTime(t => {
        const next = t + dt * speed;
        if (next >= timeline.total) {
          setPlaying(false);
          return timeline.total;
        }
        return next;
      });
      raf = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(raf);
  }, [playing, speed, timeline.total]);

  const current = opTimes.findIndex(t => time >= t.start && time < t.end);
  const select = (i: number) => setSelected(s => (s === i ? null : i));

  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="relative min-h-0 flex-1 bg-[#161b24]">
          <SimCanvas board={board} time={time} selected={selected} view={view} />
          <div className="absolute top-3 left-3 flex overflow-hidden rounded-md border border-white/15 text-xs text-white/80">
            {(['3d', 'top'] as const).map(v => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={cn('px-3 py-1.5', v === view ? 'bg-white/20 text-white' : 'bg-black/30 hover:bg-white/10')}>
                {v === '3d' ? '3D' : 'Top'}
              </button>
            ))}
          </div>
          <div className="pointer-events-none absolute top-3 right-3 rounded-md bg-black/40 px-3 py-1.5 text-xs text-white/80">
            {selected !== null ? (
              <span>
                <span className="mr-1.5 inline-block size-2.5 rounded-sm" style={{ background: opColor(selected) }} />
                {ops[selected].label}: solid = removed so far, faint = still to remove
              </span>
            ) : (
              'Select an operation to see what it removes'
            )}
          </div>
        </div>
        <Timeline
          ops={ops}
          opTimes={opTimes}
          total={timeline.total}
          time={time}
          setTime={t => {
            setTime(t);
          }}
          playing={playing}
          setPlaying={p => {
            if (p && time >= timeline.total) setTime(0);
            setPlaying(p);
          }}
          speed={speed}
          setSpeed={setSpeed}
          selected={selected}
          onSelect={select}
        />
      </div>
      <aside className="flex w-80 shrink-0 flex-col border-l">
        <div className="border-b px-4 py-3">
          <div className="text-sm font-medium">Operations</div>
          <div className="text-xs text-muted-foreground">
            {ops.length} ops · {formatDuration(timeline.total)} estimated · {board.size[0].toFixed(0)}×{board.size[1].toFixed(0)}×
            {board.size[2].toFixed(1)} mm
          </div>
        </div>
        <ol className="min-h-0 flex-1 overflow-y-auto p-2">
          {ops.map((op, i) => (
            <li key={op.index}>
              <button
                onClick={() => select(i)}
                className={cn(
                  'flex w-full items-start gap-2 rounded-md px-2 py-2 text-left text-sm',
                  selected === i ? 'bg-muted ring-1 ring-primary/40' : 'hover:bg-muted/60'
                )}>
                <span className="mt-1 size-3 shrink-0 rounded-sm" style={{ background: opColor(i) }} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate">
                    {i + 1}. {op.label}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {formatDuration(opTimes[i].start)} → {formatDuration(opTimes[i].end)} ·{' '}
                    {formatDuration(opTimes[i].end - opTimes[i].start)}
                    {time >= opTimes[i].end ? ' · done' : current === i ? ' · cutting' : ''}
                  </span>
                </span>
              </button>
              {selected === i && (
                <div className="flex gap-1 px-7 pb-2">
                  <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setTime(opTimes[i].start)}>
                    Jump to start
                  </Button>
                  <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setTime(opTimes[i].end)}>
                    Jump to end
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ol>
      </aside>
    </div>
  );
}

function Timeline({
  ops,
  opTimes,
  total,
  time,
  setTime,
  playing,
  setPlaying,
  speed,
  setSpeed,
  selected,
  onSelect,
}: {
  ops: PocOp[];
  opTimes: { start: number; end: number }[];
  total: number;
  time: number;
  setTime: (t: number) => void;
  playing: boolean;
  setPlaying: (p: boolean) => void;
  speed: number;
  setSpeed: (s: number) => void;
  selected: number | null;
  onSelect: (i: number) => void;
}) {
  const pct = (t: number) => `${(t / Math.max(total, 1e-6)) * 100}%`;
  return (
    <div className="flex items-center gap-3 border-t px-4 py-3">
      <Button
        size="icon"
        variant="outline"
        className="size-9 shrink-0"
        onClick={() => setPlaying(!playing)}
        aria-label={playing ? 'Pause' : 'Play'}>
        {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
      </Button>
      <div className="min-w-0 flex-1">
        {/* One band per operation; click to select. */}
        <div className="relative mb-1 h-3">
          {ops.map((op, i) => (
            <button
              key={op.index}
              title={op.label}
              onClick={() => onSelect(i)}
              className={cn(
                'absolute top-0 h-full rounded-[2px] border border-background',
                selected !== null && selected !== i && 'opacity-30'
              )}
              style={{ left: pct(opTimes[i].start), width: pct(opTimes[i].end - opTimes[i].start), background: opColor(i) }}
            />
          ))}
        </div>
        <input
          type="range"
          className="w-full accent-primary"
          min={0}
          max={total}
          step={total / 2000}
          value={time}
          onChange={e => setTime(Number(e.target.value))}
          aria-label="Playhead"
        />
      </div>
      <div className="w-24 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
        {formatDuration(time)} / {formatDuration(total)}
      </div>
      <select
        className="h-8 rounded-md border bg-background px-1 text-xs"
        value={speed}
        onChange={e => setSpeed(Number(e.target.value))}
        aria-label="Speed">
        {[5, 20, 60, 200].map(s => (
          <option key={s} value={s}>
            {s}×
          </option>
        ))}
      </select>
    </div>
  );
}

function SimCanvas({ board, time, selected, view }: { board: PocBoard; time: number; selected: number | null; view: View }) {
  const [w, h, top] = board.size;
  const box = useMemo(() => new Box3(new Vector3(0, 0, 0), new Vector3(w, h, top)), [w, h, top]);
  return (
    <Canvas camera={{ fov: 30, up: [0, 0, 1] }} dpr={[1, 2]} className="!absolute inset-0">
      <Sim board={board} time={time} selected={selected} />
      <FitCamera box={box} view={view} />
      <OrbitControls makeDefault />
    </Canvas>
  );
}

function Sim({ board, time, selected }: { board: PocBoard; time: number; selected: number | null }) {
  const gl = useThree(s => s.gl);
  const { toolpath, ops } = board;
  const [w, h, zTop] = board.size;
  const timeline = useMemo(() => getJobTimeline(toolpath), [toolpath]);
  const domain = useMemo(() => {
    const pad = kDefaultPlan.bit.diameter;
    const footprint = new Box2(new Vector2(-pad, -pad), new Vector2(w + pad, h + pad));
    const zLow = Math.min(0, toolpath.getBounds().min.z) - 1;
    const size = heightmapSize(footprint, Math.min(kMaxHeightmap, gl.capabilities.maxTextureSize));
    return { footprint, zTop, zLow, width: size.width, height: size.height };
  }, [w, h, zTop, toolpath, gl]);
  // Main simulation, plus the stock before and after the selected op (for its removal mask).
  const stampers = useMemo(() => {
    const shape = () => ({ kind: 'flat' as const, radius: kDefaultPlan.bit.diameter / 2 });
    return [0, 1, 2].map(() => new HeightmapStamper(toolpath, domain, shape));
  }, [toolpath, domain]);
  useEffect(() => () => stampers.forEach(s => s.dispose()), [stampers]);

  const playhead = playheadAt(timeline.times, time);
  const op = selected !== null ? ops[selected] : null;
  useFrame(() => {
    stampers[0].update(gl, playhead);
    if (op) {
      stampers[1].update(gl, { index: op.from, fraction: 1 });
      stampers[2].update(gl, { index: op.to, fraction: 1 });
    }
  });

  return (
    <>
      <StockMesh
        domain={domain}
        bottom={0}
        current={stampers[0].depthTexture}
        before={stampers[1].depthTexture}
        after={stampers[2].depthTexture}
        highlight={op ? new Color(opColor(selected!)) : null}
      />
      {op ? (
        <OpLines toolpath={toolpath} from={op.from} to={op.to} playhead={playhead} color={opColor(selected!)} />
      ) : (
        <OpLines toolpath={toolpath} from={0} to={toolpath.pathPoints.length - 1} playhead={playhead} color="#7dd3fc" faint />
      )}
      <ToolMarker board={board} playhead={playhead} />
    </>
  );
}

function ToolMarker({ board, playhead }: { board: PocBoard; playhead: Playhead }) {
  const r = kDefaultPlan.bit.diameter / 2;
  const points = board.toolpath.pathPoints;
  const b = points[Math.min(playhead.index, points.length - 1)];
  const a = points[Math.max(playhead.index - 1, 0)];
  const p = new Vector3().lerpVectors(a, b, playhead.fraction);
  return (
    <group position={p}>
      <mesh position={[0, 0, 12]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[r, r, 24, 24]} />
        <meshBasicMaterial color="#38bdf8" transparent opacity={0.55} depthTest={false} />
      </mesh>
    </group>
  );
}

function FitCamera({ box, view }: { box: Box3; view: View }) {
  const camera = useThree(s => s.camera) as PerspectiveCamera;
  const controls = useThree(s => s.controls) as OrbitControlsImpl | null;
  const aspect = useThree(s => s.size.width / s.size.height);
  useEffect(() => {
    const center = box.getCenter(new Vector3());
    const size = box.getSize(new Vector3());
    const radius = Math.max(size.x / Math.min(aspect, 1.6), size.y) * (view === 'top' ? 0.58 : 0.62);
    const dist = radius / Math.tan((camera.fov / 360) * Math.PI);
    const dir = view === 'top' ? new Vector3(0, -0.001, 1) : new Vector3(0.15, -0.8, 1);
    camera.up.set(0, 0, 1);
    camera.position.copy(center).addScaledVector(dir.normalize(), dist);
    camera.near = dist / 100;
    camera.far = dist * 20;
    camera.lookAt(center);
    camera.updateProjectionMatrix();
    if (controls) {
      controls.target.copy(center);
      controls.update();
    }
  }, [box, camera, controls, aspect, view]);
  return null;
}
