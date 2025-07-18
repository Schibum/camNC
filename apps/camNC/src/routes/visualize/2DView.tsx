import { UnprojectVideoMesh } from '@/calibration/Unproject';
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
import { ThreeElements, ThreeEvent } from '@react-three/fiber';
import { createFileRoute, redirect } from '@tanstack/react-router';
import { PageHeader } from '@wbcnc/ui/components/page-header';
import { toast } from '@wbcnc/ui/components/sonner';
import { useHotkeys } from 'react-hotkeys-hook';
import { Vector2, Vector3 } from 'three';
import { useSetSnapPosition, useSetSnapToToolpath, useSnapPosition, useSnapToToolpath, useStore } from '../../store/store';

export const Route = createFileRoute('/visualize/2DView')({
  component: VisualizeComponent,
  loader: async () => {
    const extrinsics = useStore.getState().camSource?.extrinsics;
    if (!extrinsics) {
      throw redirect({ to: '/setup/point-selection' });
    }
  },
});

const UnprojectVideoMeshWithStockHeight = ({ ...props }: ThreeElements['mesh']) => {
  const stockHeight = useStore(s => s.stockHeight);
  return <UnprojectVideoMesh position-z={stockHeight} {...props} />;
};
UnprojectVideoMeshWithStockHeight.displayName = 'UnprojectVideoMeshWithStockHeight';

function VisualizeComponent() {
  useInitToolpathOffset();
  const cncApi = getCncApi();
  useAutoScanMarkers({ intervalMs: 3_000 });
  const snapEnabled = useSnapToToolpath();
  const setSnapPosition = useSetSnapPosition();
  const snapPos = useSnapPosition();
  const setSnapToToolpath = useSetSnapToToolpath();
  const toolpath = useStore(s => s.toolpath);
  const toolpathOffset = useStore(s => s.toolpathOffset);

  // Disable snap-to-toolpath mode when user presses ESC
  useHotkeys(
    'esc',
    () => {
      if (snapEnabled) {
        setSnapToToolpath(false);
      }
    },
    [snapEnabled]
  );

  function onDbClick(event: ThreeEvent<MouseEvent>) {
    if (!snapEnabled) return onClickSnap();
    console.log('onDbClick', event.unprojectedPoint);
    if (!cncApi?.isConnected()) {
      toast.error('FluicNC integration not connected');
      return;
    }
    const point = event.unprojectedPoint;
    const bounds = useStore.getState().camSource?.machineBounds;
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
      toast.error('FluicNC integration not connected');
      return;
    }
    const bounds = useStore.getState().camSource?.machineBounds;
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
      <PageHeader title="Top View (Orthographic)" className="absolute pr-2 flex-wrap h-auto p-1">
        <VisualizeToolbar />
      </PageHeader>

      {/* 3D Canvas */}
      <div className="w-full h-dvh absolute top-0 left-0">
        <PresentCanvas worldScale="machine">
          {/* <group rotation={[0, 0, Math.PI / 2]}> */}
          <UnprojectVideoMeshWithStockHeight onDoubleClick={onDbClick} onPointerMove={onPointerMove} />
          <GCodeVisualizer />
          <MachinePositionMarker />
          <SnapPositionMarker />
          <MachineZeroAxes />
          {/* </group> */}

          {/* <TransformToolpath /> */}
        </PresentCanvas>
      </div>
    </div>
  );
}
