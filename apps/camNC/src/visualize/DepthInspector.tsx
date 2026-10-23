import { useCamSource, useStore } from '@/store/store';
import { Switch } from '@heroui/react';
import { Edges, Html, Line, OrbitControls } from '@react-three/drei';
import { ThreeEvent, useFrame, useThree } from '@react-three/fiber';
import { Slider } from '@wbcnc/ui/components/slider';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Color, OrthographicCamera, Vector3 } from 'three';
import { LineMaterial, LineSegments2, LineSegmentsGeometry } from 'three/addons';
import { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import {
  buildDepthGeometryData,
  closestPointOnSegment,
  DepthLevel,
  getCutDepthLevels,
  getSegmentMotion,
  getStockFootprint,
  ZeroAt,
} from './depthInspection';
import { HoverInfo, useDepthView, useHoverInfo, useSelectedLevel, useShowStockVideo, useZeroPlacement } from './depthViewStore';
import { ParsedToolpath } from './gcodeParsing';

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

// Scene background; toolpath colors are lifted to stay high contrast against it.
const kBackground = new Color('#111318');

// Hover pick tolerance in screen pixels.
const kPickTolerancePx = 6;
// Show per-level labels in the scene only up to this many levels to avoid clutter.
const kMaxLevelLabels = 12;
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
    if (colors) geom.setColors(colors);
    return geom;
  }, [positions, colors]);
  const material = useMemo(
    () =>
      new LineMaterial({
        color: colors ? 'white' : color,
        vertexColors: !!colors,
        linewidth: lineWidth,
        // Always in the transparent pass, so renderOrder puts colors above their outline.
        transparent: true,
        opacity,
        dashed: dashSize !== undefined,
        dashSize,
        gapSize: dashSize,
        depthTest: false,
      }),
    [colors, color, lineWidth, opacity, dashSize]
  );
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

function ToolpathSegments({
  toolpath,
  showRapids,
  dashSize,
  onHover,
}: {
  toolpath: ParsedToolpath;
  showRapids: boolean;
  dashSize: number;
  onHover: (info: HoverInfo | null) => void;
}) {
  const data = useMemo(() => buildDepthGeometryData(toolpath, kBackground), [toolpath]);

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
      <FatSegments positions={data.cutPositions} color={kOutlineColor} opacity={kOutlineOpacity} lineWidth={4} renderOrder={1} />
      <FatSegments
        positions={data.cutPositions}
        colors={data.cutColors}
        lineWidth={2}
        renderOrder={2}
        onPointerMove={hoverHandler(data.cutSegmentIndex)}
        onPointerOut={() => onHover(null)}
      />
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
            color="#d1d5db"
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

  const gridSize = Math.ceil((xySize * 1.4) / 10) * 10;
  const labelLevels = levels.length <= kMaxLevelLabels ? levels : [levels[0], levels[levels.length - 1]];
  // Scene Z (relative to the stock top, scaled) of a toolpath Z.
  const sceneZ = (z: number) => (z + shift) * zScale;
  const labelPos = (z: number) => [footprint.min.x, footprint.min.y, sceneZ(z)] as [number, number, number];

  return (
    <>
      <color attach="background" args={[kBackground]} />
      <OrbitControls makeDefault enableDamping={false} />
      <CameraRig box={fitBox} view={view} fitKey={fitKey} />

      <group position={workOrigin}>
        {/* Z0 reference grid, replaced by the video plane when shown */}
        {!showVideo && (
          <gridHelper
            args={[gridSize, Math.min(gridSize / 10, 100), '#4b5563', '#2a2f38']}
            position={[center.x, center.y, 0]}
            rotation-x={Math.PI / 2}
          />
        )}
        {/* Toolpath zero */}
        <group position-z={sceneZ(0)}>
          <Line
            points={[
              [0, 0, 0],
              [xySize * 0.15, 0, 0],
            ]}
            color="#ef4444"
            lineWidth={2}
          />
          <Line
            points={[
              [0, 0, 0],
              [0, xySize * 0.15, 0],
            ]}
            color="#22c55e"
            lineWidth={2}
          />
          <Line
            points={[
              [0, 0, 0],
              [0, 0, xySize * 0.15],
            ]}
            color="#3b82f6"
            lineWidth={2}
          />
        </group>

        <group scale={[1, 1, zScale]}>
          <group position-z={shift}>
            <ToolpathSegments
              toolpath={toolpath}
              showRapids={showRapids}
              dashSize={xySize / 150}
              onHover={info => setHover(toolpath, info)}
            />
          </group>
          {stockHeight > 0 && (
            <mesh position={[center.x, center.y, -stockHeight / 2]} raycast={() => null}>
              <boxGeometry args={[planeSize[0], planeSize[1], stockHeight]} />
              {/* The top face is coplanar with the video, push it behind to avoid z-fighting. */}
              <meshBasicMaterial
                color="#d6a35c"
                transparent
                opacity={0.06}
                depthWrite={false}
                polygonOffset
                polygonOffsetFactor={2}
                polygonOffsetUnits={8}
              />
              <Edges color="#d6a35c" />
            </mesh>
          )}
          {selectedLevel !== null && (
            <mesh position={[center.x, center.y, selectedLevel + shift]} renderOrder={3} raycast={() => null}>
              <planeGeometry args={planeSize} />
              <meshBasicMaterial color="#38bdf8" transparent opacity={0.18} depthWrite={false} depthTest={false} side={2} />
            </mesh>
          )}
        </group>

        {labelLevels.map(level => (
          <Html key={level.z} position={labelPos(level.z)} center={false} style={{ pointerEvents: 'none' }}>
            <div className="-translate-x-full -translate-y-1/2 whitespace-nowrap pr-1 text-[10px] font-mono text-gray-300">
              {formatMm(level.z)} —
            </div>
          </Html>
        ))}

        {hover && (
          <>
            {/* Markers skip the depth test so they show through the video plane. */}
            <mesh position={[hover.point.x, hover.point.y, sceneZ(hover.point.z)]} renderOrder={3} raycast={() => null}>
              <sphereGeometry args={[xySize / 120, 12, 12]} />
              <meshBasicMaterial color="white" depthTest={false} transparent />
            </mesh>
            <Line
              points={[
                [hover.point.x, hover.point.y, sceneZ(0)],
                [hover.point.x, hover.point.y, sceneZ(hover.point.z)],
              ]}
              color="white"
              lineWidth={1}
              dashed
              depthTest={false}
              transparent
              renderOrder={3}
              dashSize={xySize / 100}
              gapSize={xySize / 150}
            />
          </>
        )}
      </group>
    </>
  );
}

function LevelList({
  levels,
  selected,
  onSelect,
}: {
  levels: DepthLevel[];
  selected: number | null;
  onSelect: (z: number | null) => void;
}) {
  if (levels.length === 0) return <div className="p-2 text-xs text-muted-foreground">No horizontal cutting moves</div>;
  return (
    <ul className="text-xs font-mono">
      {levels.map(level => (
        <li key={level.z}>
          <button
            type="button"
            className={`flex w-full justify-between gap-2 px-2 py-0.5 text-left hover:bg-muted ${selected === level.z ? 'bg-sky-500/20' : ''}`}
            onClick={() => onSelect(selected === level.z ? null : level.z)}>
            <span>{formatMm(level.z)}</span>
            <span className="text-muted-foreground">{level.length.toFixed(0)}mm</span>
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
        <div className="flex rounded-md bg-black/5 p-0.5" role="group" aria-label="Z0 at stock">
          {(Object.keys(kZeroAtLabels) as ZeroAt[]).map(z => (
            <button
              key={z}
              type="button"
              aria-pressed={zeroAt === z}
              className={`rounded px-1.5 py-0.5 ${zeroAt === z ? 'bg-white font-semibold shadow-sm' : 'text-muted-foreground'}`}
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

  const setZeroAt = useDepthView(s => s.setZeroAt);
  const { zeroAt, guessed, isGuess, shift } = useZeroPlacement(toolpath);
  const levels = useMemo(() => getCutDepthLevels(toolpath), [toolpath]);
  const bounds = toolpath.getBounds();
  // Depth of the deepest cut below the stock bottom, in toolpath Z.
  const belowStock = stockHeight > 0 ? -stockHeight - shift - bounds.min.z : 0;

  return (
    <div
      className="pointer-events-auto flex max-h-full w-48 flex-col overflow-hidden rounded-lg bg-white/85 shadow-md backdrop-blur-sm"
      role="region"
      aria-label="Depth Inspector">
      <button
        type="button"
        className="flex items-center justify-between gap-2 px-2 py-1.5 text-xs font-medium hover:bg-muted/60"
        aria-expanded={!collapsed}
        onClick={() => setCollapsed(c => !c)}>
        <span>
          Depth <span className="font-mono text-muted-foreground">{formatMm(bounds.min.z)}</span>
        </span>
        {collapsed ? <ChevronDown className="size-4" /> : <ChevronUp className="size-4" />}
      </button>
      {!collapsed && (
        <>
          <div className="grid gap-2 border-t px-2 py-2">
            <Slider
              aria-label="Z scale"
              label="Z scale"
              size="sm"
              minValue={1}
              maxValue={20}
              step={0.5}
              value={zScale}
              onChange={setZScale}
            />
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
          <div className="grid gap-0.5 border-t px-2 py-1.5 text-xs">
            <div>
              Min Z: <span className="font-mono font-medium">{formatMm(bounds.min.z)}</span>
            </div>
            <div>
              Max Z: <span className="font-mono">{formatMm(bounds.max.z)}</span>
            </div>
            {stockHeight > 0 && (
              <div className={belowStock > 0 ? 'text-red-600' : 'text-muted-foreground'}>
                {belowStock > 0
                  ? `${formatMm(belowStock)}mm below ${zeroAt === 'bottom' ? 'Z0' : 'stock'}`
                  : `Stock: ${formatMm(stockHeight)}mm`}
              </div>
            )}
          </div>
          <div className="border-t px-2 pt-1 text-xs font-medium">Cut levels (Z · length)</div>
          <div className="min-h-0 flex-1 overflow-auto pb-1">
            <LevelList levels={levels} selected={selectedLevel} onSelect={z => setSelected(toolpath, z)} />
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
    <div className="pointer-events-none rounded bg-black/60 px-2 py-1 font-mono text-xs text-gray-200">
      {hover ? (
        <>
          X {formatMm(hover.point.x)} Y {formatMm(hover.point.y)} <span className="font-bold text-white">Z {formatMm(hover.point.z)}</span>{' '}
          {hover.motion}
        </>
      ) : (
        <span className="text-gray-400">Hover the path to read exact positions</span>
      )}
    </div>
  );
}
