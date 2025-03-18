import { UnskewedVideoMesh } from '@/calibration/UnskewTsl';
import { PresentCanvas } from '@/scene/PresentCanvas';
import { createFileRoute } from '@tanstack/react-router';
import { useMachineSize, useVideoToMachineHomography, useStore } from '../../store';
import { Breadcrumb, BreadcrumbItem, BreadcrumbList, BreadcrumbPage } from '@/components/ui/breadcrumb';
import { SidebarTrigger } from '@/components/ui/sidebar';
import { Separator } from '@radix-ui/react-separator';
import { TransformControls } from '@react-three/drei';
import { useThree } from '@react-three/fiber';
import { GCodeVisualizer } from '@/visualize/Toolpaths';

export const Route = createFileRoute('/visualize/2DView')({
  component: VisualizeComponent,
  beforeLoad: () => {
    return { customSidebar: true };
  },
});

function TransformToolpath() {
  const scene = useThree(state => state.scene);
  const isSelected = useStore(s => s.isToolpathSelected);
  if (!isSelected) return null;
  console.log(scene.getObjectByName('toolpath'));
  return <TransformControls showZ={false} object={scene.getObjectByName('toolpath')} />;
}

function VisualizeComponent() {
  return (
    <div className="relative w-full h-full">
      <header className="flex h-10 shrink-0 items-center gap-2 z-10 absolute bg-white/80 rounded-br-lg">
        <div className="flex items-center gap-2 px-4">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="mr-2 h-4" />
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem>
                <BreadcrumbPage>Data Fetching</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        </div>
      </header>

      {/* 3D Canvas */}
      <div className="w-full h-dvh absolute top-0 left-0">
        <PresentCanvas worldScale="machine">
          {/* <group rotation={[0, 0, Math.PI / 2]}> */}
          <UnskewedFlatVideoMesh />
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
    <group position={[-offsetX, -offsetY, -100]}>
      <UnskewedVideoMesh matrix={videoToMachineHomography} matrixAutoUpdate={false} />
    </group>
  );
}
