import { UnskewedVideoMesh } from '@/calibration/UnskewTsl';
import { PresentCanvas } from '@/scene/PresentCanvas';
import { createFileRoute } from '@tanstack/react-router';
import { useMachineSize, useVideoToMachineHomography } from '../../store';
import { GCodeVisualizer } from '@/visualize/Toolpaths';
import { PageHeader } from '@/components/ui/page-header';
import { UnprojectVideoMesh } from '@/calibration/Unproject';
import { useComputeP3P } from '@/calibration/solveP3P';
import { use } from 'react';
import { ensureOpenCvIsLoaded } from '@/lib/loadOpenCv';

export const Route = createFileRoute('/visualize/2DView')({
  component: VisualizeComponent,
  beforeLoad: () => {
    return { customSidebar: true };
  },
});

function VisualizeComponent() {
  use(ensureOpenCvIsLoaded());
  console.log('p3p', useComputeP3P());
  return (
    <div className="relative w-full h-full">
      <PageHeader title="2D Toolpath Visualization" className="absolute" />

      {/* 3D Canvas */}
      <div className="w-full h-dvh absolute top-0 left-0">
        <PresentCanvas worldScale="machine">
          {/* <group rotation={[0, 0, Math.PI / 2]}> */}
          <UnprojectVideoMesh />
          <GCodeVisualizer />
          {/* </group> */}

          {/* <TransformToolpath /> */}
        </PresentCanvas>
      </div>
    </div>
  );
}

function UnskewedFlatVideoMesh() {
  const videoToMachineHomography = useVideoToMachineHomography();
  const [offsetX, offsetY] = useMachineSize().divideScalar(2).toArray();

  return (
    <group position={[0, 0, -100]}>
      <UnskewedVideoMesh matrix={videoToMachineHomography} matrixAutoUpdate={false} />
    </group>
  );
}
