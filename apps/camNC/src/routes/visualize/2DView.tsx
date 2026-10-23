import { UnprojectVideoMesh } from '@/calibration/Unproject';
import { EnsureHasCamSource } from '@/components/EnsureHasCamSource';
import { PageHeader } from '@/components/page-header';
import { useAutoScanMarkers } from '@/hooks/useAutoScanMarkers';
import { DepthBlendWorker } from '@/hooks/useDepthBlendWorker';
import { useInitToolpathOffset } from '@/hooks/useInitToolpathOffset';
import { getCncApi } from '@/lib/fluidnc/fluidnc-singleton';
import { PresentCanvas } from '@/scene/PresentCanvas';
import { MachinePositionMarker } from '@/visualize/MachinePositionMarker';
import { MachineZeroAxes } from '@/visualize/MachineZeroAxes';
import { SnapPositionMarker } from '@/visualize/SnapPositionMarker';
import { GCodeVisualizer } from '@/visualize/Toolpaths';
import { nearestPointOnToolpath } from '@/visualize/nearestPoint';
import { VisualizeToolbar } from '@/visualize/toolbar/VisualizeToolbar';
import { DepthHoverReadout, DepthPanel, DepthScene } from '@/visualize/DepthInspector';
import { getStockFootprint } from '@/visualize/depthInspection';
import { useShowStockVideo } from '@/visualize/depthViewStore';
import { ViewSwitcher } from '@/visualize/toolbar/ViewSwitcher';
import { kViewModes, ViewMode, viewModeTitle } from '@/visualize/viewModes';
import { ThreeEvent, useThree } from '@react-three/fiber';
import { createFileRoute } from '@tanstack/react-router';
import { zodValidator } from '@tanstack/zod-adapter';
import { toast } from '@wbcnc/ui/components/sonner';
import { ComponentProps, RefObject, useEffect, useMemo, useRef, useState } from 'react';
import { useHotkeys } from 'react-hotkeys-hook';
import { Vector2, Vector3 } from 'three';
import { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { z } from 'zod';
import {
  getActiveCamSource,
  useSetSnapPosition,
  useSetSnapToToolpath,
  useSnapPosition,
  useSnapToToolpath,
  useStore,
} from '../../store/store';

export const Route = createFileRoute('/visualize/2DView')({
  component: () => (
    <EnsureHasCamSource to="/setup/point-selection" predicate={s => !!s.extrinsics}>
      <VisualizeComponent />
    </EnsureHasCamSource>
  ),
  validateSearch: zodValidator(
    z.object({
      view: z.enum(kViewModes as [ViewMode, ...ViewMode[]]).optional(),
    })
  ),
});

const UnprojectVideoMeshWithStockHeight = ({ ...props }: ComponentProps<typeof UnprojectVideoMesh>) => {
  const stockHeight = useStore(s => s.stockHeight);
  return <UnprojectVideoMesh position-z={stockHeight} {...props} />;
};
UnprojectVideoMeshWithStockHeight.displayName = 'UnprojectVideoMeshWithStockHeight';

interface TopCameraState {
  position: Vector3;
  zoom: number;
  target: Vector3;
}

/** Restores the top view's pan and zoom when coming back from a 3D view. */
function TopCameraMemory({ memory }: { memory: RefObject<TopCameraState | null> }) {
  const camera = useThree(s => s.camera);
  const controls = useThree(s => s.controls) as OrbitControlsImpl | null;
  useEffect(() => {
    if (!controls) return;
    const saved = memory.current;
    if (saved) {
      camera.position.copy(saved.position);
      camera.zoom = saved.zoom;
      camera.updateProjectionMatrix();
      controls.target.copy(saved.target);
      controls.update();
    }
    return () => {
      memory.current = { position: camera.position.clone(), zoom: camera.zoom, target: controls.target.clone() };
    };
  }, [camera, controls, memory]);
  return null;
}

function VisualizeComponent() {
  useInitToolpathOffset();
  const navigate = Route.useNavigate();
  const toolpath = useStore(s => s.toolpath);
  const requestedView = Route.useSearch({ select: s => s.view ?? 'top' });
  // The 3D views need a toolpath to show.
  const view = toolpath ? requestedView : 'top';
  const isTop = view === 'top';
  // Re-fits the camera when the active 3D view is selected again.
  const [fitKey, setFitKey] = useState(0);
  const topCamera = useRef<TopCameraState | null>(null);
  const showStockVideo = useShowStockVideo();
  const toolpathOffset = useStore(s => s.toolpathOffset);
  // In the 3D views, the video only covers the stock top, so the stock box and the cuts below stay visible.
  const stockTop = useMemo(
    () => (toolpath ? getStockFootprint(toolpath).translate(new Vector2(toolpathOffset.x, toolpathOffset.y)) : undefined),
    [toolpath, toolpathOffset.x, toolpathOffset.y]
  );

  function selectView(next: ViewMode) {
    if (next === view) setFitKey(k => k + 1);
    else navigate({ search: { view: next === 'top' ? undefined : next }, replace: true });
  }

  const cncApi = getCncApi();
  useAutoScanMarkers({ intervalMs: 3_000 });
  const snapEnabled = useSnapToToolpath();
  const setSnapPosition = useSetSnapPosition();
  const snapPos = useSnapPosition();
  const setSnapToToolpath = useSetSnapToToolpath();

  // Disable snap-to-toolpath mode when user presses ESC
  useHotkeys(
    'esc',
    () => {
      if (snapEnabled) {
        setSnapToToolpath(false);
      }
    },
    { enabled: isTop },
    [snapEnabled]
  );

  function onDbClick(event: ThreeEvent<MouseEvent>) {
    if (snapEnabled) return onClickSnap();
    console.log('onDbClick', event.unprojectedPoint);
    if (!cncApi?.isConnected()) {
      toast.error('FluidNC integration not connected');
      return;
    }
    const point = event.unprojectedPoint;
    const bounds = getActiveCamSource()?.machineBounds;
    if (!bounds) return;
    if (!bounds.containsPoint(new Vector2(point.x, point.y))) {
      toast.info('Cannot jog outside machine bounds');
      return;
    }
    cncApi?.jogToMachineCoordinates(point.x, point.y);
    toast.success(`Jogging to ${point.x.toFixed(2)}, ${point.y.toFixed(2)}`);
  }

  function onPointerMove(event: ThreeEvent<PointerEvent>) {
    if (!snapEnabled || !toolpath) {
      setSnapPosition(null);
      return;
    }
    const point = event.unprojectedPoint as Vector3;
    const nearest = nearestPointOnToolpath(toolpath, point, toolpathOffset);
    setSnapPosition(nearest);
  }

  function onClickSnap() {
    if (!snapEnabled) return;
    const pos = snapPos;
    if (!pos) return;
    if (!cncApi?.isConnected()) {
      toast.error('FluidNC integration not connected');
      return;
    }
    const bounds = getActiveCamSource()?.machineBounds;
    if (!bounds) return;
    if (!bounds.containsPoint(new Vector2(pos.x, pos.y))) {
      toast.info('Cannot jog outside machine bounds');
      return;
    }
    cncApi.jogToMachineCoordinates(pos.x, pos.y);
    toast.success(`Jogging to ${pos.x.toFixed(2)}, ${pos.y.toFixed(2)}`);
  }

  return (
    <div className="relative w-full h-full">
      <DepthBlendWorker />

      {/* One canvas for all views: the camera video keeps running when switching between them. */}
      <div className="w-full h-dvh absolute top-0 left-0">
        <PresentCanvas worldScale="machine" defaultControls={isTop}>
          {/* <group rotation={[0, 0, Math.PI / 2]}> */}
          <UnprojectVideoMeshWithStockHeight
            visible={isTop || showStockVideo}
            bounds={isTop ? undefined : stockTop}
            opacity={isTop ? 1 : 0.7}
            // In the 3D views, the video is drawn first, below the toolpath.
            renderOrder={isTop ? 0 : -2}
            onDoubleClick={isTop ? onDbClick : undefined}
            onPointerMove={isTop ? onPointerMove : undefined}
          />
          {isTop || !toolpath ? (
            <>
              <TopCameraMemory memory={topCamera} />
              <GCodeVisualizer />
              <MachinePositionMarker />
              <SnapPositionMarker />
              <MachineZeroAxes />
            </>
          ) : (
            <DepthScene toolpath={toolpath} view={view} fitKey={fitKey} />
          )}
          {/* </group> */}

          {/* <TransformToolpath /> */}
        </PresentCanvas>
      </div>

      <div className="pointer-events-none absolute inset-0 flex h-dvh flex-col">
        <PageHeader title={viewModeTitle(view)} className="pointer-events-auto pr-2 flex-wrap h-auto p-1">
          <div className="pl-2">
            <ViewSwitcher view={view} hasToolpath={!!toolpath} onSelect={selectView} />
          </div>
          <VisualizeToolbar />
        </PageHeader>
        {!isTop && toolpath && (
          <div className="relative min-h-0 flex-1">
            <div className="absolute top-2 right-2 bottom-12 flex flex-col items-end">
              <DepthPanel toolpath={toolpath} />
            </div>
            <div className="absolute bottom-2 left-2">
              <DepthHoverReadout toolpath={toolpath} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
