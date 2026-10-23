import { UnprojectVideoMesh } from '@/calibration/Unproject';
import { getMachinePlaneLayout } from '@/calibration/machinePlane';
import { useCamSource, useMachineBounds, useStore } from '@/store/store';
import { Button, Switch } from '@heroui/react';
import { Edges, Html, Line, OrbitControls } from '@react-three/drei';
import { Canvas, ThreeEvent, useFrame, useThree } from '@react-three/fiber';
import { Slider } from '@wbcnc/ui/components/slider';
import { Suspense, useEffect, useMemo, useState } from 'react';
import { ErrorBoundary } from 'react-error-boundary';
import { Color, OrthographicCamera, Vector3 } from 'three';
import { LineMaterial, LineSegments2, LineSegmentsGeometry } from 'three/addons';
import { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { buildDepthGeometryData, closestPointOnSegment, DepthLevel, getCutDepthLevels, getSegmentMotion } from './depthInspection';
import { ParsedToolpath } from './gcodeParsing';

type ViewPreset = 'iso' | 'front' | 'side' | 'top';

// Direction from the look-at target towards the camera (Z up).
const kViewDirections: Record<ViewPreset, Vector3> = {
  iso: new Vector3(1, -1, 0.8),
  // Looking along +Y: shows X/Z.
  front: new Vector3(0, -1, 0),
  // Looking along -X: shows Y/Z.
  side: new Vector3(1, 0, 0),
  // Slightly tilted, as orbit controls degenerate when looking exactly along the up axis.
  top: new Vector3(0, -1e-3, 1),
};

// Scene background; toolpath colors are lifted to stay high contrast against it.
const kBackground = new Color('#111318');

const kViewLabels: Record<ViewPreset, string> = { iso: '3D', front: 'Front (XZ)', side: 'Side (YZ)', top: 'Top' };

// Hover pick tolerance in screen pixels.
const kPickTolerancePx = 6;
// Show per-level labels in the scene only up to this many levels to avoid clutter.
const kMaxLevelLabels = 12;

interface HoverInfo {
  point: Vector3;
  motion?: string;
}

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

/**
 * Live camera image projected onto the stock top plane (machine coordinates, z = stock height),
 * dimmed so the toolpath stays readable on top of it.
 */
function StockVideo() {
  const stockHeight = useStore(s => s.stockHeight);
  const machineBounds = useMachineBounds();
  const overSize = 50;
  const { width, height, center } = getMachinePlaneLayout(machineBounds, overSize);
  return (
    <>
      <UnprojectVideoMesh overSize={overSize} position-z={stockHeight} renderOrder={-2} raycast={() => null} />
      <mesh position={[center.x, center.y, stockHeight]} renderOrder={-1} raycast={() => null}>
        <planeGeometry args={[width, height]} />
        {/* Coplanar with the video: offset towards the camera to avoid z-fighting stripes. */}
        <meshBasicMaterial
          color="black"
          transparent
          opacity={0.45}
          depthWrite={false}
          polygonOffset
          polygonOffsetFactor={-2}
          polygonOffsetUnits={-8}
        />
      </mesh>
    </>
  );
}

function CameraRig({ box, view, fitKey }: { box: { center: Vector3; radius: number }; view: ViewPreset; fitKey: number }) {
  const camera = useThree(s => s.camera) as OrthographicCamera;
  const controls = useThree(s => s.controls) as OrbitControlsImpl | null;
  const get = useThree(s => s.get);

  useEffect(() => {
    if (!controls) return;
    const { width, height } = get().size;
    const dir = kViewDirections[view].clone().normalize();
    camera.position.copy(box.center).addScaledVector(dir, box.radius * 4);
    camera.zoom = Math.min(width, height) / (box.radius * 2.4);
    camera.updateProjectionMatrix();
    controls.target.copy(box.center);
    controls.update();
  }, [camera, controls, get, box, view, fitKey]);

  useFrame(({ raycaster }) => {
    raycaster.params.Line2 = { threshold: kPickTolerancePx };
  });
  return null;
}

function DepthScene({
  toolpath,
  levels,
  zScale,
  showRapids,
  view,
  fitKey,
  showVideo,
  selectedLevel,
  hover,
  onHover,
}: {
  toolpath: ParsedToolpath;
  levels: DepthLevel[];
  zScale: number;
  showRapids: boolean;
  view: ViewPreset;
  fitKey: number;
  showVideo: boolean;
  selectedLevel: number | null;
  hover: HoverInfo | null;
  onHover: (info: HoverInfo | null) => void;
}) {
  const stockHeight = useStore(s => s.stockHeight);
  const toolpathOffset = useStore(s => s.toolpathOffset);
  const bounds = toolpath.getBounds();
  // Toolpath (work) coordinates are placed in machine coordinates, like in the top view, with Z0 at the stock top.
  const workOrigin = useMemo(
    () => new Vector3(toolpathOffset.x, toolpathOffset.y, stockHeight),
    [toolpathOffset.x, toolpathOffset.y, stockHeight]
  );

  const xySize = Math.max(bounds.max.x - bounds.min.x, bounds.max.y - bounds.min.y, 1);
  const pad = xySize * 0.05;
  const center = useMemo(() => new Vector3((bounds.min.x + bounds.max.x) / 2, (bounds.min.y + bounds.max.y) / 2, 0), [bounds]);
  const planeSize: [number, number] = [bounds.max.x - bounds.min.x + 2 * pad, bounds.max.y - bounds.min.y + 2 * pad];

  const fitBox = useMemo(() => {
    const min = bounds.min.clone().setZ(Math.min(bounds.min.z, -stockHeight, 0) * zScale);
    const max = bounds.max.clone().setZ(Math.max(bounds.max.z, 0) * zScale);
    return { center: min.clone().add(max).multiplyScalar(0.5).add(workOrigin), radius: Math.max(min.distanceTo(max) / 2, 1) };
  }, [bounds, stockHeight, zScale, workOrigin]);

  const gridSize = Math.ceil((xySize * 1.4) / 10) * 10;
  const labelLevels = levels.length <= kMaxLevelLabels ? levels : [levels[0], levels[levels.length - 1]];
  const labelPos = (z: number) => [bounds.min.x - pad, bounds.min.y - pad, z * zScale] as [number, number, number];

  return (
    <>
      <color attach="background" args={[kBackground]} />
      <OrbitControls makeDefault enableDamping={false} />
      <CameraRig box={fitBox} view={view} fitKey={fitKey} />

      {showVideo && (
        <ErrorBoundary fallback={null}>
          <Suspense fallback={null}>
            <StockVideo />
          </Suspense>
        </ErrorBoundary>
      )}

      <group position={workOrigin}>
        {/* Z0 reference grid, replaced by the video plane when shown */}
        {!showVideo && (
          <gridHelper
            args={[gridSize, Math.min(gridSize / 10, 100), '#4b5563', '#2a2f38']}
            position={[center.x, center.y, 0]}
            rotation-x={Math.PI / 2}
          />
        )}
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

        <group scale={[1, 1, zScale]}>
          <ToolpathSegments toolpath={toolpath} showRapids={showRapids} dashSize={xySize / 150} onHover={onHover} />
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
            <mesh position={[center.x, center.y, selectedLevel]} renderOrder={3} raycast={() => null}>
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
            <mesh position={[hover.point.x, hover.point.y, hover.point.z * zScale]} renderOrder={3} raycast={() => null}>
              <sphereGeometry args={[xySize / 120, 12, 12]} />
              <meshBasicMaterial color="white" depthTest={false} transparent />
            </mesh>
            <Line
              points={[
                [hover.point.x, hover.point.y, 0],
                [hover.point.x, hover.point.y, hover.point.z * zScale],
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

/**
 * 3D view of the toolpath with true Z, to verify cut depths directly rather than
 * only through the depth color map of the top view.
 */
export function DepthInspector({ toolpath }: { toolpath: ParsedToolpath }) {
  const stockHeight = useStore(s => s.stockHeight);
  const camSource = useCamSource();
  const canShowVideo = !!camSource?.extrinsics && !!camSource.machineBounds;
  const [videoEnabled, setVideoEnabled] = useState(true);
  const showVideo = canShowVideo && videoEnabled;
  const [view, setView] = useState<ViewPreset>('iso');
  const [fitKey, setFitKey] = useState(0);
  const [zScale, setZScale] = useState(1);
  const [showRapids, setShowRapids] = useState(true);
  const [selectedLevel, setSelectedLevel] = useState<number | null>(null);
  const [hover, setHover] = useState<HoverInfo | null>(null);
  // Selection and hover refer to the previous toolpath's geometry, reset them when another file is loaded.
  const [prevToolpath, setPrevToolpath] = useState(toolpath);
  if (toolpath !== prevToolpath) {
    setPrevToolpath(toolpath);
    setSelectedLevel(null);
    setHover(null);
  }

  const levels = useMemo(() => getCutDepthLevels(toolpath), [toolpath]);
  const bounds = toolpath.getBounds();
  // Assumes Z0 at the stock top.
  const belowStock = stockHeight > 0 ? -stockHeight - bounds.min.z : 0;

  function selectView(v: ViewPreset) {
    setView(v);
    setFitKey(k => k + 1);
  }

  return (
    <div className="flex h-full min-h-0 flex-col" role="region" aria-label="Depth Inspector">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b px-2 py-1">
        <div className="flex gap-1">
          {(Object.keys(kViewLabels) as ViewPreset[]).map(v => (
            <Button key={v} size="sm" variant={view === v ? 'flat' : 'light'} className="h-7 min-w-0 px-2" onPress={() => selectView(v)}>
              {kViewLabels[v]}
            </Button>
          ))}
        </div>
        <Slider
          aria-label="Z scale"
          label="Z scale"
          size="sm"
          className="w-32"
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
      </div>
      <div className="flex min-h-0 flex-1">
        <div className="relative min-w-0 flex-1">
          <Canvas
            orthographic
            // The video texture needs continuous rendering.
            frameloop={showVideo ? 'always' : 'demand'}
            // Keep the depth range tight (mm) for depth precision on the coplanar video planes.
            camera={{ up: [0, 0, 1], near: -1e4, far: 1e4 }}
            onPointerMissed={() => setHover(null)}>
            <DepthScene
              toolpath={toolpath}
              levels={levels}
              zScale={zScale}
              showRapids={showRapids}
              view={view}
              fitKey={fitKey}
              showVideo={showVideo}
              selectedLevel={selectedLevel}
              hover={hover}
              onHover={setHover}
            />
          </Canvas>
          <div className="pointer-events-none absolute bottom-1 left-2 font-mono text-xs text-gray-200">
            {hover ? (
              <>
                X {formatMm(hover.point.x)} Y {formatMm(hover.point.y)}{' '}
                <span className="font-bold text-white">Z {formatMm(hover.point.z)}</span> {hover.motion}
              </>
            ) : (
              <span className="text-gray-400">Hover the path to read exact positions</span>
            )}
          </div>
        </div>
        <div className="hidden w-40 shrink-0 flex-col border-l sm:flex">
          <div className="grid gap-0.5 border-b p-2 text-xs">
            <div>
              Min Z: <span className="font-mono font-medium">{formatMm(bounds.min.z)}</span>
            </div>
            <div>
              Max Z: <span className="font-mono">{formatMm(bounds.max.z)}</span>
            </div>
            {stockHeight > 0 && (
              <div className={belowStock > 0 ? 'text-red-600' : 'text-muted-foreground'}>
                {belowStock > 0 ? `${formatMm(belowStock)}mm below stock` : `Stock: ${formatMm(stockHeight)}mm`}
              </div>
            )}
          </div>
          <div className="px-2 pt-1 text-xs font-medium">Cut levels (Z · length)</div>
          <div className="min-h-0 flex-1 overflow-auto">
            <LevelList levels={levels} selected={selectedLevel} onSelect={setSelectedLevel} />
          </div>
        </div>
      </div>
    </div>
  );
}
