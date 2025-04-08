import { UnprojectVideoMesh } from '@/calibration/Unproject';
import { UnskewedVideoMesh } from '@/calibration/UnskewTsl';
import { PageHeader } from '@/components/ui/page-header';
import { setWorkspaceXYZero } from '@/lib/cnc-api';
import { PresentCanvas } from '@/scene/PresentCanvas';
import { CommandsMenu } from '@/visualize/CommandsMenu';
import { GCodeVisualizer } from '@/visualize/Toolpaths';
import { ThreeElements, ThreeEvent } from '@react-three/fiber';
import { createFileRoute } from '@tanstack/react-router';
import React from 'react';
import * as THREE from 'three';
import { useMachineSize, useStore, useVideoToMachineHomography } from '../../store';

export const Route = createFileRoute('/visualize/2DView')({
  component: VisualizeComponent,
  beforeLoad: () => {
    return { customSidebar: true };
  },
});

const UnprojectVideoMeshWithStockHeight = React.forwardRef<THREE.Mesh, ThreeElements['mesh']>(({ ...props }, ref) => {
  const stockHeight = useStore(s => s.stockHeight);
  return <UnprojectVideoMesh ref={ref} position-z={stockHeight} {...props} />;
});
UnprojectVideoMeshWithStockHeight.displayName = 'UnprojectVideoMeshWithStockHeight';

function VisualizeComponent() {
  function onDbClick(event: ThreeEvent<MouseEvent>) {
    console.log('onDbClick', event.unprojectedPoint);
    const point = event.unprojectedPoint;
    setWorkspaceXYZero(point.x, point.y);
  }

  return (
    <div className="relative w-full h-full">
      <PageHeader title="2D Toolpath Visualization" className="absolute pr-2">
        <CommandsMenu />
      </PageHeader>
      {/* 3D Canvas */}
      <div className="w-full h-dvh absolute top-0 left-0">
        <PresentCanvas worldScale="machine">
          {/* <group rotation={[0, 0, Math.PI / 2]}> */}
          <UnprojectVideoMeshWithStockHeight onDoubleClick={onDbClick} />
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
