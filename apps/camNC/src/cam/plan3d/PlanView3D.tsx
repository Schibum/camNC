import { Canvas, useThree } from '@react-three/fiber';
import { cn } from '@wbcnc/ui/lib/utils';
import { Focus } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Vector3 } from 'three';
import { playheadAt, type Playhead } from '@/visualize/stockSim/jobTimeline';
import type { ToolShape } from '@/visualize/stockSim/toolShapes';
import type { BoardRequest, CamPartInfo, PlanResult } from '../camTypes';
import { Hint } from '../Hint';
import { PartGhost, StockBox } from './BoardGhosts';
import { CameraRig } from './CameraRig';
import type { PlanPlayback } from './planPlayback';
import { kViewBackground } from './palette';
import { boardBox, cutBounds, groupOpsOf, type PlanModel } from './planModel';
import { projectionOf, usePlan3dView } from './plan3dViewStore';
import { kCompareTolerance } from './compareMap';
import { PlanTimeline } from './PlanTimeline';
import { SimLines, SimStock } from './SimStock';
import { ToolpathLayers } from './ToolpathLayers';

/** See-through stock opacity: cuts and toolpaths show through, the board's shape still reads. */
const kSeeThroughOpacity = 0.3;
/** Zoom to an op: at least this much board (mm) on the short side of the view, so a small hole keeps its context. */
const kOpMinSpan = 16;

/**
 * The board's program in 3D. Result: the simulated board up to the playhead, with the timeline. Toolpath: every op's
 * moves at their real depth. The op list beside it shares the playback; selecting an op frames it. It fills the height
 * it's given (from md up), at least 420 px on a phone.
 */
export function PlanView3D({
  plan,
  board,
  parts,
  playback,
  className,
}: {
  plan: PlanResult;
  board: BoardRequest;
  parts: CamPartInfo[];
  /** Playhead, selection and hidden ops, shared with the op list beside the view. */
  playback: PlanPlayback;
  className?: string;
}) {
  const { model, time, setTime, selected, select, playing, setPlaying, speed, setSpeed } = playback;
  const { mode, seeThrough, view, ortho3d, showRapids, setMode, setSeeThrough, setView, setOrtho3d, setShowRapids } = usePlan3dView();
  const timed = mode !== 'toolpath';
  const [fitCount, setFitCount] = useState(0);

  const selectedOps = useMemo(() => (selected === null ? [] : groupOpsOf(model, selected)), [model, selected]);
  const bitRadius = (selected !== null ? model.groups[selected].op.tool.diameter : (plan.bits[0] ?? 3)) / 2;
  const frameBox = useMemo(
    () => (selectedOps.length && cutBounds(model.toolpath, selectedOps, bitRadius, plan.size[2])) || boardBox(plan),
    [model, selectedOps, bitRadius, plan]
  );
  const frameKey = `${board.id}:${plan.size.join('x')}:${selected ?? 'board'}:${fitCount}`;

  const label = selected !== null ? model.groups[selected].label : null;
  const hint =
    mode !== 'toolpath'
      ? label
        ? `${label}: solid where it has cut, a tint where it still cuts`
        : 'Select an operation to see what it removes'
      : label
        ? `${label} on its own`
        : 'Click an operation to isolate it';

  return (
    <section
      aria-label={`3D view of board ${board.name}`}
      data-mode={mode}
      className={cn('flex flex-col overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800', className)}>
      <div className="flex h-[420px] min-w-0 flex-col md:h-auto md:min-h-0 md:flex-1">
        <div className="relative min-h-0 flex-1" style={{ background: kViewBackground }}>
          <Canvas dpr={[1, 2]} frameloop="demand" className="absolute! inset-0">
            <color attach="background" args={[kViewBackground]} />
            <Scene model={model} plan={plan} board={board} parts={parts} time={timed ? time : model.total} ui={playback} />
            <CameraRig
              box={frameBox}
              frameKey={frameKey}
              view={view}
              projection={projectionOf(view, ortho3d)}
              margin={selected !== null ? 1.6 : 1.12}
              minSpan={selected !== null ? kOpMinSpan : 0}
            />
          </Canvas>
          <div className="absolute top-2.5 left-2.5 flex flex-wrap gap-1.5">
            <Segmented
              label="Show"
              value={mode}
              onChange={setMode}
              options={[
                ['result', 'Result', 'The board as it comes out, cut up to the playhead.'],
                [
                  'compare',
                  'Compare',
                  "The cut board against your model: green as designed, orange where material is left, red where it's cut too deep.",
                ],
                ['toolpath', 'Toolpath', 'Every move of the bit, at its real depth, through a see-through board.'],
              ]}
            />
            <Segmented
              label="View"
              value={view}
              onChange={setView}
              options={[
                ['3d', '3D', 'Look at the board at an angle. Drag to turn it.'],
                ['top', 'Top', 'Look straight down on the board.'],
              ]}
            />
            {view === '3d' && (
              <Toggle
                pressed={ortho3d}
                onChange={setOrtho3d}
                hint="No perspective: sizes compare true across the whole board. The top view always is.">
                Orthographic
              </Toggle>
            )}
            {mode === 'result' && (
              <Toggle
                pressed={seeThrough}
                onChange={setSeeThrough}
                hint="A see-through board: the toolpaths and the finished parts show through it.">
                See through
              </Toggle>
            )}
            {mode === 'toolpath' && (
              <Toggle
                pressed={showRapids}
                onChange={setShowRapids}
                hint="Show the fast moves between cuts, with the bit up out of the wood.">
                Rapids
              </Toggle>
            )}
            <Hint text={selected !== null ? 'Zoom back to the selected operation.' : 'Fit the whole board in the view again.'}>
              <button
                className={cn(kChip, 'px-2')}
                aria-label={selected !== null ? 'Zoom to the operation' : 'Show the whole board'}
                onClick={() => setFitCount(c => c + 1)}>
                <Focus className="size-3.5" />
              </button>
            </Hint>
          </div>
          {mode === 'compare' ? (
            <div
              role="note"
              aria-label="Compared to the model"
              className="pointer-events-none absolute right-2.5 bottom-2.5 flex flex-wrap gap-x-3 gap-y-1 rounded-md bg-black/60 px-2.5 py-1.5 text-xs text-zinc-100">
              {(
                [
                  ['#22b259', `As designed (±${kCompareTolerance} mm)`],
                  ['#f58c1a', 'Material left'],
                  ['#db2626', 'Cut too deep'],
                ] as const
              ).map(([c, t]) => (
                <span key={t} className="flex items-center gap-1.5">
                  <span className="size-2.5 rounded-sm" style={{ background: c }} />
                  {t}
                </span>
              ))}
            </div>
          ) : (
            <div className="pointer-events-none absolute right-2.5 bottom-2.5 max-w-[60%] rounded-md bg-black/50 px-2.5 py-1 text-xs text-zinc-200">
              {hint}
            </div>
          )}
        </div>
        {timed && (
          <PlanTimeline
            model={model}
            time={time}
            onTime={t => {
              setPlaying(false);
              setTime(t);
            }}
            playing={playing}
            onPlaying={p => {
              if (p && time >= model.total) setTime(0);
              setPlaying(p);
            }}
            speed={speed}
            onSpeed={setSpeed}
            selected={selected}
            onSelect={g => select(g === selected ? null : g)}
          />
        )}
      </div>
    </section>
  );
}

function Scene({
  model,
  plan,
  board,
  parts,
  time,
  ui,
}: {
  model: PlanModel;
  plan: PlanResult;
  board: BoardRequest;
  parts: CamPartInfo[];
  time: number;
  ui: { selected: number | null; hidden: ReadonlySet<number> };
}) {
  const { mode, showRapids, seeThrough: resultSeeThrough } = usePlan3dView();
  // Toolpath always shows through the board; Compare never does, so its colours read true.
  const seeThrough = mode === 'toolpath' || (mode === 'result' && resultSeeThrough);
  const compare = mode === 'compare';
  const { selected, hidden } = ui;
  // Frames only on demand: a still view draws nothing (the battery, the fan, and a long job on a laptop).
  const invalidate = useThree(s => s.invalidate);
  useEffect(() => invalidate());
  const comparing = useMemo(() => (compare ? { board, parts } : undefined), [compare, board, parts]);
  const playhead = playheadAt(model.times, time);
  const selectedOps = useMemo(() => (selected === null ? [] : groupOpsOf(model, selected)), [model, selected]);
  const highlight = selected !== null ? model.groups[selected].color : '#ffffff';
  const toolShape = useCallback(
    (tool: number | undefined): ToolShape => {
      const d = (tool !== undefined && model.bits.get(tool)) || (plan.bits[0] ?? 3);
      return { kind: 'flat', radius: d / 2 };
    },
    [plan, model]
  );
  const [w, h, top] = plan.size;
  const groupOps = useMemo(() => model.groups.map((_, n) => groupOpsOf(model, n)), [model]);

  return (
    <>
      <ambientLight intensity={0.9} />
      <directionalLight position={[w * 0.3, -h, Math.max(w, h)]} intensity={1.4} />
      {mode === 'toolpath' && seeThrough ? (
        <StockBox size={plan.size} />
      ) : (
        <SimStock
          toolpath={model.toolpath}
          size={plan.size}
          toolShape={toolShape}
          playhead={playhead}
          selected={selectedOps}
          highlight={highlight}
          opacity={seeThrough ? kSeeThroughOpacity : 1}
          compare={comparing}
        />
      )}
      {seeThrough && <PartGhost board={board} parts={parts} />}
      {mode === 'toolpath' ? (
        <ToolpathLayers model={model} hidden={hidden} isolated={selected} showRapids={showRapids} onTop={seeThrough} />
      ) : selected !== null ? (
        <SimLines
          toolpath={model.toolpath}
          ops={selectedOps}
          playhead={playhead}
          color={highlight}
          opacity={1}
          doneOpacity={0.7}
          onTop={seeThrough}
        />
      ) : seeThrough ? (
        model.groups.map((g, n) => (
          <SimLines key={g.key} toolpath={model.toolpath} ops={groupOps[n]} playhead={playhead} color={g.color} opacity={0.8} onTop />
        ))
      ) : (
        time < model.total && (
          <SimLines
            toolpath={model.toolpath}
            ops={model.ops}
            playhead={playhead}
            color="#f4f4f5"
            opacity={0.45}
            doneOpacity={0}
            onTop={false}
          />
        )
      )}
      {mode !== 'toolpath' && time < model.total && (
        <ToolMarker model={model} playhead={playhead} radius={toolShape(model.toolpath.modals[playhead.index]?.tool).radius} top={top} />
      )}
    </>
  );
}

/** The bit at the playhead: a faint cylinder standing on the cut. */
function ToolMarker({ model, playhead, radius, top }: { model: PlanModel; playhead: Playhead; radius: number; top: number }) {
  const points = model.toolpath.pathPoints;
  const b = points[Math.min(playhead.index, points.length - 1)];
  const a = points[Math.max(playhead.index - 1, 0)];
  const p = new Vector3().lerpVectors(a, b, playhead.fraction);
  const length = Math.max(top - p.z, 0) + 20;
  return (
    <mesh position={[p.x, p.y, p.z + length / 2]} rotation={[Math.PI / 2, 0, 0]} renderOrder={4}>
      <cylinderGeometry args={[radius, radius, length, 24]} />
      <meshBasicMaterial color="#f4f4f5" transparent opacity={0.55} depthTest={false} />
    </mesh>
  );
}

const kChip =
  'inline-flex h-7 items-center rounded-md border border-white/15 bg-zinc-950/70 text-xs text-zinc-300 backdrop-blur hover:text-white';

function Segmented<T extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: T;
  onChange: (v: T) => void;
  /** Value, label, what it shows. */
  options: [T, string, string][];
}) {
  return (
    <div role="group" aria-label={label} className={cn(kChip, 'overflow-hidden p-0.5')}>
      {options.map(([v, text, hint]) => (
        <Hint key={v} text={hint} side="bottom">
          <button
            aria-pressed={v === value}
            onClick={() => onChange(v)}
            className={cn('h-full rounded px-2.5', v === value ? 'bg-white text-zinc-900' : 'hover:bg-white/10')}>
            {text}
          </button>
        </Hint>
      ))}
    </div>
  );
}

function Toggle({
  pressed,
  onChange,
  hint,
  children,
}: {
  pressed: boolean;
  onChange: (p: boolean) => void;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <Hint text={hint} side="bottom">
      <button
        aria-pressed={pressed}
        onClick={() => onChange(!pressed)}
        className={cn(kChip, 'px-2.5', pressed && 'bg-white text-zinc-900 hover:text-zinc-900')}>
        {children}
      </button>
    </Hint>
  );
}
