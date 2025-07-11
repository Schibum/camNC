import { UnprojectVideoMesh } from '@/calibration/Unproject';
import { useAutoScanMarkers } from '@/hooks/useAutoScanMarkers';
import { DepthBlendWorker } from '@/hooks/useDepthBlendWorker';
import { useInitToolpathOffset } from '@/hooks/useInitToolpathOffset';
import { getCncApi } from '@/lib/fluidnc/fluidnc-singleton';
import { PresentCanvas } from '@/scene/PresentCanvas';
import { MachinePositionMarker } from '@/visualize/MachinePositionMarker';
import { MachineZeroAxes } from '@/visualize/MachineZeroAxes';
import { GCodeVisualizer } from '@/visualize/Toolpaths';
import { VisualizeToolbar } from '@/visualize/toolbar/VisualizeToolbar';
import { ThreeElements, ThreeEvent } from '@react-three/fiber';
import { createFileRoute, redirect } from '@tanstack/react-router';
import { PageHeader } from '@wbcnc/ui/components/page-header';
import { toast } from '@wbcnc/ui/components/sonner';
import { useStore } from '../../store/store';
import { useMarkerScanIntervalMs } from '../../store/store';

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
  const scanInterval = useMarkerScanIntervalMs();
  useAutoScanMarkers({ intervalMs: scanInterval });

  function onDbClick(event: ThreeEvent<MouseEvent>) {
    console.log('onDbClick', event.unprojectedPoint);
    if (!cncApi?.isConnected()) {
      toast.error('FluicNC integration not connected');
      return;
    }
    const point = event.unprojectedPoint;
    cncApi?.jogToMachineCoordinates(point.x, point.y);
    toast.success(`Jogging to ${point.x.toFixed(2)}, ${point.y.toFixed(2)}`);
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
          <UnprojectVideoMeshWithStockHeight onDoubleClick={onDbClick} />
          <GCodeVisualizer />
          <MachinePositionMarker />
          <MachineZeroAxes />
          {/* </group> */}

          {/* <TransformToolpath /> */}
        </PresentCanvas>
      </div>
    </div>
  );
}
