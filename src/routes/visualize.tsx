import { UnskewedVideoMesh } from '@/calibration/UnskewTsl';
import { createFileRoute } from '@tanstack/react-router';
import { useMachineSize, useVideoToMachineHomography } from '../store';
import { PresentCanvas } from '@/scene/PresentCanvas';

export const Route = createFileRoute('/visualize')({
  component: VisualizeComponent,
});

function VisualizeComponent() {
  const renderSize = useMachineSize();
  // TODO: router away if no valid calibration config.

  return (
    <div className="p-2">
      <div style={{ width: renderSize[0], height: renderSize[1] }}>
        <PresentCanvas worldScale="machine">
          <color attach="background" args={[0x1111ff]} />
          <UnskewedFlatVideoMesh />
        </PresentCanvas>
      </div>
    </div>
  );
}

function UnskewedFlatVideoMesh() {
  const videoToMachineHomography = useVideoToMachineHomography();
  const machineSize = useMachineSize();
  const offsetX = machineSize[0] / 2;
  const offsetY = machineSize[1] / 2;

  return (
    <group position={[-offsetX, -offsetY, 0]}>
      <UnskewedVideoMesh matrix={videoToMachineHomography} matrixAutoUpdate={false} />
    </group>
  );
}
