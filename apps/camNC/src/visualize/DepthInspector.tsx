import { useCamSource, useStore } from '@/store/store';
import { Switch } from '@heroui/react';
import { GizmoHelper, GizmoViewport, Line, OrbitControls } from '@react-three/drei';
import { ThreeEvent, useFrame, useThree } from '@react-three/fiber';
import { Slider } from '@wbcnc/ui/components/slider';
import { cn } from '@wbcnc/ui/lib/utils';
import { ChevronDown, ChevronUp, CircleCheck, CircleDashed } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Color, OrthographicCamera, Vector3 } from 'three';
import { LineMaterial, LineSegments2, LineSegmentsGeometry } from 'three/addons';
import { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import {
  buildDepthGeometryData,
  closestPointOnSegment,
  DepthLevel,
  fadeOutsideLevel,
  getCutDepthLevels,
  getCutZRange,
  getLevelSegmentPositions,
  getSegmentMotion,
  getStockFootprint,
  kOvercutTolerance,
  withMinContrast,
  ZeroAt,
} from './depthInspection';
import { HoverInfo, useDepthView, useHoverInfo, useSelectedLevel, useShowStockVideo, useZeroPlacement } from './depthViewStore';
import { AxisLabel, BedGrid, DepthRuler, HoverMarker, LevelPlane, StockBlock } from './DepthSceneParts';
import { ParsedToolpath } from './gcodeParsing';
import { getPlasmaColor } from './toolpathColors';

export type DepthViewPreset = '3d' | 'front' | 'side';

// Direction from the look-at target towards the camera (Z up).
const kViewDirections: Record<DepthViewPreset, Vector3> = {
  // Tilted up from the bottom edge of the top view (which shows +X up), so the switch keeps its orientation.
  '3d': new Vector3(-1, -0.5, 0.9),
  // Looking along +Y: shows X/Z.
  front: new Vector3(0, -1, 0),
  // Looking along -X: shows Y/Z.
  side: new Vector3(1, 0, 0),
};

// Approximate scene background (a CSS gradient behind the transparent canvas, see `kDepthSceneBackground`, shared with the top view); toolpath
// colors are lifted to stay high contrast against it.
const kBackground = new Color('#161b24');
export const kDepthSceneBackground = 'radial-gradient(ellipse at 50% 40%, #1f2633 0%, #141922 55%, #0b0e13 100%)';

// Hover pick tolerance in screen pixels.
const kPickTolerancePx = 6;
// Duration of the camera move between views.
const kTransitionMs = 450;

function formatMm(value: number) {
  return value.toFixed(2);
}

interface FatSegmentsProps {
  positions: Float32Array;
  colors?: Float32Array;
  color?: string;
  // Width in screen pixels.
  lineWidth: number;
  opacity?: number;
  dashSize?: number;
  renderOrder: number;
  onPointerMove?: (e: ThreeEvent<PointerEvent>) => void;
  onPointerOut?: () => void;
}

/** Screen-space wide line segments, drawn without depth test so they stay visible through the video plane. */
function FatSegments({
  positions,
  colors,
  color = 'white',
  lineWidth,
  opacity = 1,
  dashSize,
  renderOrder,
  onPointerMove,
  onPointerOut,
}: FatSegmentsProps) {
  const size = useThree(s => s.size);
  const geometry = useMemo(() => {
    const geom = new LineSegmentsGeometry();
    geom.setPositions(positions);
    return geom;
  }, [positions]);
  // Colors change on the same geometry: replacing the line object would drop its pointer handlers.
  useEffect(() => {
    if (colors) geometry.setColors(colors);
  }, [geometry, colors]);
  const hasColors = !!colors;
  const material = useMemo(
    () =>
      new LineMaterial({
        color: hasColors ? 'white' : color,
        vertexColors: hasColors,
        linewidth: lineWidth,
        // Always in the transparent pass, so renderOrder puts colors above their outline.
        transparent: true,
        dashed: dashSize !== undefined,
        dashSize,
        gapSize: dashSize,
        depthTest: false,
      }),
    [hasColors, color, lineWidth, dashSize]
  );
  useEffect(() => {
    material.opacity = opacity;
  }, [material, opacity]);
  const line = useMemo(() => {
    const segments = new LineSegments2(geometry, material);
    if (dashSize !== undefined) segments.computeLineDistances();
    return segments;
  }, [geometry, material, dashSize]);

  useEffect(() => {
    material.resolution.set(size.width, size.height);
  }, [material, size]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  useEffect(() => () => material.dispose(), [material]);

  return (
    <primitive
      object={line}
      renderOrder={renderOrder}
      raycast={onPointerMove ? LineSegments2.prototype.raycast : () => null}
      onPointerMove={onPointerMove}
      onPointerOut={onPointerOut}
    />
  );
}

// A dark outline below every path line keeps it readable on any background, including the stock video.
const kOutlineColor = '#000000';
const kOutlineOpacity = 0.85;
// Selected cut level, as in the level list and the depth ruler.
const kSelectedLevelColor = '#38bdf8';

function ToolpathSegments({
  toolpath,
  showRapids,
  dashSize,
  selectedLevel,
  onHover,
}: {
  toolpath: ParsedToolpath;
  showRapids: boolean;
  dashSize: number;
  // Cut level to make stand out, other segments are faded.
  selectedLevel: number | null;
  onHover: (info: HoverInfo | null) => void;
}) {
  const data = useMemo(() => buildDepthGeometryData(toolpath, kBackground), [toolpath]);
  const cutColors = useMemo(
    () => (selectedLevel === null ? data.cutColors : fadeOutsideLevel(data.cutPositions, data.cutColors, selectedLevel, kBackground)),
    [data, selectedLevel]
  );
  const levelPositions = useMemo(
    () => (selectedLevel === null ? null : getLevelSegmentPositions(data.cutPositions, selectedLevel)),
    [data, selectedLevel]
  );

  function hoverHandler(segmentIndex: Uint32Array) {
    return (e: ThreeEvent<PointerEvent>) => {
      e.stopPropagation();
      if (e.faceIndex == null) return;
      const index = segmentIndex[e.faceIndex];
      // The parent groups move and scale Z, convert back into toolpath coordinates.
      const local = e.object.worldToLocal((e.pointOnLine ?? e.point).clone());
      onHover({ point: closestPointOnSegment(toolpath, index, local), motion: getSegmentMotion(toolpath, index) });
    };
  }

  return (
    <>
      <FatSegments positions={data.cutPositions} color={kOutlineColor} opacity={kOutlineOpacity} lineWidth={4.5} renderOrder={1} />
      <FatSegments
        positions={data.cutPositions}
        colors={cutColors}
        lineWidth={2.5}
        renderOrder={2}
        onPointerMove={hoverHandler(data.cutSegmentIndex)}
        onPointerOut={() => onHover(null)}
      />
      {levelPositions && levelPositions.length > 0 && (
        <FatSegments positions={levelPositions} color={kSelectedLevelColor} lineWidth={3.5} renderOrder={3} />
      )}
      {showRapids && data.rapidSegmentIndex.length > 0 && (
        <>
          <FatSegments
            positions={data.rapidPositions}
            color={kOutlineColor}
            opacity={kOutlineOpacity}
            lineWidth={3.5}
            dashSize={dashSize}
            renderOrder={1}
          />
          <FatSegments
            positions={data.rapidPositions}
            color="#cbd5e1"
            opacity={selectedLevel === null ? 0.9 : 0.35}
            lineWidth={1.5}
            dashSize={dashSize}
            renderOrder={2}
            onPointerMove={hoverHandler(data.rapidSegmentIndex)}
            onPointerOut={() => onHover(null)}
          />
        </>
      )}
    </>
  );
}

interface CameraPose {
  target: Vector3;
  // Camera position relative to the target.
  offset: Vector3;
  zoom: number;
}

const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

/** Moves the orthographic camera to fit the toolpath from the given view, animated from wherever it currently is. */
function CameraRig({ box, view, fitKey }: { box: { center: Vector3; radius: number }; view: DepthViewPreset; fitKey: number }) {
  const camera = useThree(s => s.camera) as OrthographicCamera;
  const controls = useThree(s => s.controls) as OrbitControlsImpl | null;
  const get = useThree(s => s.get);
  const invalidate = useThree(s => s.invalidate);
  const transition = useRef<{ start: number; from: CameraPose; to: CameraPose } | null>(null);
  // Until the first fit, the camera still looks straight down, as positioned by the top view.
  const fromTopView = useRef(true);

  // The video plane extends far beyond the toolpath, behind the camera in tilted views. Keep the
  // depth range tight (mm) though, for depth precision on the coplanar video planes.
  useEffect(() => {
    const { near, far } = camera;
    camera.near = -1e4;
    camera.far = 1e4;
    camera.updateProjectionMatrix();
    return () => {
      camera.near = near;
      camera.far = far;
      camera.updateProjectionMatrix();
    };
  }, [camera]);

  useEffect(() => {
    if (!controls) return;
    const { width, height } = get().size;
    const distance = box.radius * 4;
    const to = {
      target: box.center.clone(),
      offset: kViewDirections[view].clone().normalize().multiplyScalar(distance),
      zoom: Math.min(width, height) / (box.radius * 2.4),
    };
    const from = fromTopView.current
      ? {
          target: new Vector3(camera.position.x, camera.position.y, box.center.z),
          // Slightly tilted towards -X to keep the top view's orientation (+X up on screen).
          offset: new Vector3(-1e-3, 0, 1).normalize().multiplyScalar(distance),
          zoom: camera.zoom,
        }
      : { target: controls.target.clone(), offset: camera.position.clone().sub(controls.target), zoom: camera.zoom };
    fromTopView.current = false;
    transition.current = { start: performance.now(), from, to };
    invalidate();
  }, [camera, controls, get, invalidate, box, view, fitKey]);

  useFrame(({ raycaster }) => {
    raycaster.params.Line2 = { threshold: kPickTolerancePx };
    const current = transition.current;
    if (!current || !controls) return;
    const t = Math.min((performance.now() - current.start) / kTransitionMs, 1);
    const k = easeInOut(t);
    const { from, to } = current;
    controls.target.lerpVectors(from.target, to.target, k);
    const length = from.offset.length() * (1 - k) + to.offset.length() * k;
    const offset = from.offset.clone().normalize().lerp(to.offset.clone().normalize(), k).normalize().multiplyScalar(length);
    camera.position.copy(controls.target).add(offset);
    camera.zoom = from.zoom * (to.zoom / from.zoom) ** k;
    camera.updateProjectionMatrix();
    controls.update();
    if (t < 1) invalidate();
    else transition.current = null;
  });
  return null;
}

/**
 * Toolpath with true Z, to verify cut depths directly rather than only through the depth color map of
 * the top view. Rendered inside the page's canvas; the camera image on the stock top (see `getStockFootprint`) is provided by the page.
 */
export function DepthScene({ toolpath, view, fitKey }: { toolpath: ParsedToolpath; view: DepthViewPreset; fitKey: number }) {
  const stockHeight = useStore(s => s.stockHeight);
  const toolpathOffset = useStore(s => s.toolpathOffset);
  const zScale = useDepthView(s => s.zScale);
  const showRapids = useDepthView(s => s.showRapids);
  const setHover = useDepthView(s => s.setHover);
  const showVideo = useShowStockVideo();
  const selectedLevel = useSelectedLevel(toolpath);
  const hover = useHoverInfo(toolpath);
  const levels = useMemo(() => getCutDepthLevels(toolpath), [toolpath]);
  const bounds = toolpath.getBounds();
  const { shift } = useZeroPlacement(toolpath);
  // Toolpath (work) coordinates are placed in machine coordinates, like in the top view. The origin is at the stock
  // top, so Z scaling keeps the stock top on the video plane; toolpaths zeroed at the stock bottom are shifted down.
  const workOrigin = useMemo(
    () => new Vector3(toolpathOffset.x, toolpathOffset.y, stockHeight),
    [toolpathOffset.x, toolpathOffset.y, stockHeight]
  );

  const xySize = Math.max(bounds.max.x - bounds.min.x, bounds.max.y - bounds.min.y, 1);
  const footprint = useMemo(() => getStockFootprint(toolpath), [toolpath]);
  const center = useMemo(
    () => new Vector3((footprint.min.x + footprint.max.x) / 2, (footprint.min.y + footprint.max.y) / 2, 0),
    [footprint]
  );
  const planeSize: [number, number] = [footprint.max.x - footprint.min.x, footprint.max.y - footprint.min.y];

  const fitBox = useMemo(() => {
    const min = bounds.min.clone().setZ(Math.min(bounds.min.z + shift, -stockHeight, 0) * zScale);
    const max = bounds.max.clone().setZ(Math.max(bounds.max.z + shift, 0) * zScale);
    return { center: min.clone().add(max).multiplyScalar(0.5).add(workOrigin), radius: Math.max(min.distanceTo(max) / 2, 1) };
  }, [bounds, shift, stockHeight, zScale, workOrigin]);

  // Scene Z (relative to the stock top, scaled) of a toolpath Z.
  const sceneZ = (z: number) => (z + shift) * zScale;
  const axisLength = xySize * 0.15;
  // The bed (stock bottom), or the deepest cut when it goes deeper, in work coordinates.
  const bedZ = Math.min(-stockHeight, bounds.min.z + shift) * zScale;
  const bedCenter = useMemo(() => new Vector3(center.x, center.y, 0), [center]);

  return (
    <>
      <OrbitControls makeDefault enableDamping dampingFactor={0.15} />
      <CameraRig box={fitBox} view={view} fitKey={fitKey} />
      <GizmoHelper alignment="bottom-right" margin={[64, 64]}>
        <GizmoViewport axisColors={['#ef4444', '#22c55e', '#3b82f6']} labelColor="white" axisHeadScale={0.9} hideNegativeAxes />
      </GizmoHelper>

      <group position={workOrigin}>
        <BedGrid center={bedCenter} radius={xySize * 1.6} z={bedZ - 0.01} />
        {/* Toolpath zero */}
        <group position-z={sceneZ(0)}>
          <Line
            points={[
              [0, 0, 0],
              [axisLength, 0, 0],
            ]}
            color="#ef4444"
            lineWidth={2}
          />
          <Line
            points={[
              [0, 0, 0],
              [0, axisLength, 0],
            ]}
            color="#22c55e"
            lineWidth={2}
          />
          <Line
            points={[
              [0, 0, 0],
              [0, 0, axisLength],
            ]}
            color="#3b82f6"
            lineWidth={2}
          />
          <AxisLabel position={[axisLength * 1.15, 0, 0]} label="X" className="text-red-400" />
          <AxisLabel position={[0, axisLength * 1.15, 0]} label="Y" className="text-green-400" />
          <AxisLabel position={[0, 0, axisLength * 1.15]} label="Z" className="text-blue-400" />
        </group>

        <group scale={[1, 1, zScale]}>
          <group position-z={shift}>
            <ToolpathSegments
              toolpath={toolpath}
              showRapids={showRapids}
              dashSize={xySize / 150}
              selectedLevel={selectedLevel}
              onHover={info => setHover(toolpath, info)}
            />
          </group>
          {stockHeight > 0 && <StockBlock center={center} size={planeSize} height={stockHeight} showTop={!showVideo} />}
          {selectedLevel !== null && <LevelPlane center={center} size={planeSize} z={selectedLevel + shift} />}
        </group>

        <DepthRuler levels={levels} x={footprint.min.x} y={footprint.min.y} zScale={zScale} shift={shift} selected={selectedLevel} />

        {hover && (
          <HoverMarker
            position={new Vector3(hover.point.x, hover.point.y, sceneZ(hover.point.z))}
            topZ={sceneZ(0)}
            dashSize={xySize / 100}
          />
        )}
      </group>
    </>
  );
}

/** CSS color of the toolpath lines at depth `z`, as drawn in the 3D views. */
function depthCss(z: number, range: { min: number; max: number }) {
  const t = (z - range.min) / (range.max - range.min || 1);
  return `#${withMinContrast(getPlasmaColor(t), kBackground).getHexString()}`;
}

function LevelList({
  levels,
  range,
  selected,
  onSelect,
}: {
  levels: DepthLevel[];
  range: { min: number; max: number };
  selected: number | null;
  onSelect: (z: number | null) => void;
}) {
  if (levels.length === 0) return <div className="p-2 text-xs text-muted-foreground">No horizontal cutting moves</div>;
  const longest = Math.max(...levels.map(l => l.length));
  return (
    <ul className="grid gap-px px-1 text-xs font-mono">
      {levels.map(level => (
        <li key={level.z}>
          <button
            type="button"
            className={cn(
              'relative flex w-full items-center gap-2 overflow-hidden rounded px-1.5 py-0.5 text-left hover:bg-white/10',
              selected === level.z && 'bg-sky-500/25 ring-1 ring-sky-400/60 hover:bg-sky-500/30'
            )}
            onClick={() => onSelect(selected === level.z ? null : level.z)}>
            {/* Relative cut length at this level */}
            <span className="absolute inset-y-0 left-0 bg-white/[0.06]" style={{ width: `${(level.length / longest) * 100}%` }} />
            <span className="relative size-2 shrink-0 rounded-full" style={{ background: depthCss(level.z, range) }} />
            <span className="relative">{formatMm(level.z)}</span>
            <span className="relative ml-auto text-muted-foreground">{level.length.toFixed(0)}mm</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

const kZeroAtLabels: Record<ZeroAt, string> = { top: 'Top', bottom: 'Bottom' };

function ZeroAtControl({
  zeroAt,
  guessed,
  isGuess,
  onChange,
}: {
  zeroAt: ZeroAt;
  guessed: ZeroAt;
  isGuess: boolean;
  onChange: (zeroAt: ZeroAt | null) => void;
}) {
  return (
    <div className="grid gap-1 text-xs">
      <div className="flex items-center justify-between gap-2">
        <span>Z0 at stock</span>
        <div className="flex rounded-md bg-white/10 p-0.5" role="group" aria-label="Z0 at stock">
          {(Object.keys(kZeroAtLabels) as ZeroAt[]).map(z => (
            <button
              key={z}
              type="button"
              aria-pressed={zeroAt === z}
              className={cn(
                'rounded px-1.5 py-0.5',
                zeroAt === z ? 'bg-white/90 font-semibold text-slate-900 shadow-sm' : 'text-muted-foreground'
              )}
              onClick={() => onChange(z)}>
              {kZeroAtLabels[z]}
            </button>
          ))}
        </div>
      </div>
      {isGuess ? (
        <span className="text-muted-foreground">Guessed from the toolpath</span>
      ) : (
        zeroAt !== guessed && (
          <button type="button" className="text-left text-muted-foreground underline" onClick={() => onChange(null)}>
            Use guess ({kZeroAtLabels[guessed].toLowerCase()})
          </button>
        )
      )}
    </div>
  );
}

function Stat({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className={cn('grid rounded-md bg-white/5 px-1.5 py-1', className)}>
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="font-mono text-xs font-medium">{value}</span>
    </div>
  );
}

/**
 * Setup item for the stock height, styled like a checklist entry: open and highlighted until it is set, since the
 * stock block and the below-stock warning need it.
 */
function StockHeightItem({ onFocusChange }: { onFocusChange?: (focused: boolean) => void }) {
  const stockHeight = useStore(s => s.stockHeight);
  const setStockHeight = useStore(s => s.setStockHeight);
  // Text being typed, so intermediate input like "1." is kept until the field loses focus.
  const [draft, setDraft] = useState<string | null>(null);
  const isSet = stockHeight > 0;
  const onChange = (text: string) => {
    setDraft(text);
    const value = Number(text);
    if (text.trim() !== '' && Number.isFinite(value) && value >= 0) setStockHeight(value);
  };
  return (
    <label
      className={cn(
        'flex items-center gap-2 rounded-md px-2 py-1.5 text-xs',
        isSet ? 'bg-white/5' : 'bg-amber-400/15 text-amber-100 ring-1 ring-amber-300/40'
      )}>
      {isSet ? (
        <CircleCheck className="size-4 shrink-0 text-emerald-400" aria-hidden />
      ) : (
        <CircleDashed className="size-4 shrink-0 text-amber-300" aria-hidden />
      )}
      <span className="grid flex-1 leading-tight">
        <span className="font-medium">Stock height</span>
        {!isSet && <span className="text-[10px] text-amber-200/80">Not set, needed for the stock</span>}
      </span>
      <span className="flex items-center rounded bg-black/30 ring-1 ring-white/10 focus-within:ring-sky-400/70">
        <input
          type="number"
          inputMode="decimal"
          min={0}
          step={0.1}
          aria-label="Stock height"
          className="w-12 bg-transparent py-0.5 pl-1.5 text-right font-mono text-xs outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
          value={draft ?? (isSet ? String(stockHeight) : '')}
          placeholder="0"
          onChange={e => onChange(e.target.value)}
          onFocus={() => onFocusChange?.(true)}
          onBlur={() => {
            setDraft(null);
            onFocusChange?.(false);
          }}
          onKeyDown={e => e.key === 'Enter' && e.currentTarget.blur()}
        />
        <span className="pr-1.5 pl-0.5 text-[10px] text-muted-foreground">mm</span>
      </span>
    </label>
  );
}

const kZScalePresets = [1, 2, 5, 10];

/** Floating panel with the 3D view options, depth summary and cut levels of the toolpath. */
export function DepthPanel({ toolpath }: { toolpath: ParsedToolpath }) {
  const stockHeight = useStore(s => s.stockHeight);
  const camSource = useCamSource();
  const canShowVideo = !!camSource?.extrinsics && !!camSource.machineBounds;
  const zScale = useDepthView(s => s.zScale);
  const setZScale = useDepthView(s => s.setZScale);
  const showRapids = useDepthView(s => s.showRapids);
  const setShowRapids = useDepthView(s => s.setShowRapids);
  const videoEnabled = useDepthView(s => s.videoEnabled);
  const setVideoEnabled = useDepthView(s => s.setVideoEnabled);
  const setSelected = useDepthView(s => s.setSelected);
  const selectedLevel = useSelectedLevel(toolpath);
  const [collapsed, setCollapsed] = useState(false);
  const [editingStock, setEditingStock] = useState(false);

  const setZeroAt = useDepthView(s => s.setZeroAt);
  const { zeroAt, guessed, isGuess, shift } = useZeroPlacement(toolpath);
  const levels = useMemo(() => getCutDepthLevels(toolpath), [toolpath]);
  const range = useMemo(() => getCutZRange(toolpath), [toolpath]);
  const bounds = toolpath.getBounds();
  // Depth of the deepest cut below the stock bottom, in toolpath Z.
  const belowStock = stockHeight > 0 ? -stockHeight - shift - bounds.min.z : 0;
  const gradient = useMemo(
    () =>
      `linear-gradient(to right, ${[0, 0.25, 0.5, 0.75, 1].map(t => depthCss(range.min + t * (range.max - range.min), range)).join(', ')})`,
    [range]
  );

  return (
    <div
      className="dark pointer-events-auto flex max-h-full w-56 flex-col overflow-hidden rounded-xl border border-white/10 bg-slate-900/75 text-foreground shadow-xl shadow-black/30 backdrop-blur-md"
      role="region"
      aria-label="Depth Inspector">
      <button
        type="button"
        className="flex items-center justify-between gap-2 px-3 py-2 text-xs font-medium hover:bg-white/5"
        aria-expanded={!collapsed}
        onClick={() => setCollapsed(c => !c)}>
        <span>
          Depth <span className="font-mono text-muted-foreground">{formatMm(bounds.min.z)}</span>
        </span>
        {collapsed ? <ChevronDown className="size-4" /> : <ChevronUp className="size-4" />}
      </button>
      {/* Kept visible while collapsed until it is set. */}
      {(!collapsed || stockHeight === 0 || editingStock) && (
        <div className="border-t border-white/10 px-2 py-2">
          <StockHeightItem onFocusChange={setEditingStock} />
        </div>
      )}
      {!collapsed && (
        <>
          <div className="grid gap-2.5 border-t border-white/10 px-3 py-2.5">
            <div className="grid gap-1">
              <Slider
                aria-label="Z scale"
                label="Z scale"
                size="sm"
                minValue={1}
                maxValue={20}
                step={0.5}
                value={zScale}
                onChange={setZScale}
                getValue={v => `${v}×`}
                classNames={{ label: 'text-xs', value: 'text-xs font-mono' }}
              />
              <div className="flex gap-1" role="group" aria-label="Z scale presets">
                {kZScalePresets.map(preset => (
                  <button
                    key={preset}
                    type="button"
                    aria-pressed={zScale === preset}
                    className={cn(
                      'flex-1 rounded px-1 py-0.5 font-mono text-[10px] text-muted-foreground hover:bg-white/10',
                      zScale === preset && 'bg-white/15 text-foreground'
                    )}
                    onClick={() => setZScale(preset)}>
                    {preset}×
                  </button>
                ))}
              </div>
            </div>
            <Switch size="sm" isSelected={showRapids} onValueChange={setShowRapids}>
              <span className="text-xs">Rapids</span>
            </Switch>
            {canShowVideo && (
              <Switch size="sm" isSelected={videoEnabled} onValueChange={setVideoEnabled}>
                <span className="text-xs">Stock video</span>
              </Switch>
            )}
            <ZeroAtControl zeroAt={zeroAt} guessed={guessed} isGuess={isGuess} onChange={setZeroAt} />
          </div>
          <div className="grid gap-1.5 border-t border-white/10 px-3 py-2.5">
            <div className="grid grid-cols-2 gap-1">
              <Stat label="Min Z" value={formatMm(bounds.min.z)} />
              <Stat label="Max Z" value={formatMm(bounds.max.z)} />
            </div>
            {belowStock > kOvercutTolerance ? (
              <div className="rounded-md bg-red-500/15 px-1.5 py-1 text-xs text-red-300 ring-1 ring-red-400/30">
                {`${formatMm(belowStock)}mm below ${zeroAt === 'bottom' ? 'Z0' : 'stock'}`}
              </div>
            ) : (
              belowStock > 0 && (
                <div className="text-xs text-muted-foreground" title="A small overcut lets the tool cut cleanly through the stock">
                  {`${formatMm(belowStock)}mm overcut below ${zeroAt === 'bottom' ? 'Z0' : 'stock'}`}
                </div>
              )
            )}
            <div className="grid gap-0.5" aria-hidden>
              <div className="h-1.5 rounded-full" style={{ background: gradient }} />
              <div className="flex justify-between font-mono text-[10px] text-muted-foreground">
                <span>{formatMm(range.min)}</span>
                <span>{formatMm(range.max)}</span>
              </div>
            </div>
          </div>
          <div className="flex items-baseline justify-between border-t border-white/10 px-3 pt-2 pb-1 text-xs font-medium">
            <span>Cut levels</span>
            <span className="text-[10px] font-normal text-muted-foreground">Z · length</span>
          </div>
          <div className="min-h-0 flex-1 overflow-auto pb-1.5">
            <LevelList levels={levels} range={range} selected={selectedLevel} onSelect={z => setSelected(toolpath, z)} />
          </div>
        </>
      )}
    </div>
  );
}

/** Exact position of the toolpath point under the cursor in the 3D views. */
export function DepthHoverReadout({ toolpath }: { toolpath: ParsedToolpath }) {
  const hover = useHoverInfo(toolpath);
  return (
    <div className="pointer-events-none flex items-center gap-3 rounded-lg border border-white/10 bg-slate-900/75 px-2.5 py-1.5 font-mono text-xs text-slate-300 shadow-lg shadow-black/30 backdrop-blur-md">
      {hover ? (
        <>
          <span>
            <span className="text-red-400">X</span> {formatMm(hover.point.x)}
          </span>
          <span>
            <span className="text-green-400">Y</span> {formatMm(hover.point.y)}
          </span>
          <span className="font-bold text-white">
            <span className="text-blue-400">Z</span> {formatMm(hover.point.z)}
          </span>
          {hover.motion && <span className="rounded bg-white/10 px-1 text-[10px] text-slate-200">{hover.motion}</span>}
        </>
      ) : (
        <span className="font-sans text-slate-400">Hover the path to read exact positions</span>
      )}
    </div>
  );
}
