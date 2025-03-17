import { UnskewedVideoMesh } from '@/calibration/UnskewTsl';
import { PresentCanvas } from '@/scene/PresentCanvas';
import { GCodeVisualizer } from '@/visualize/GCodeVisualizer';
import { createFileRoute } from '@tanstack/react-router';
import { useMachineSize, useVideoToMachineHomography } from '../../store';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
} from '@/components/ui/breadcrumb';
import { SidebarTrigger } from '@/components/ui/sidebar';
import { Separator } from '@radix-ui/react-separator';


export const Route = createFileRoute('/visualize/2DView')({
  component: VisualizeComponent,
  beforeLoad: () => {
    return { customSidebar: true };
  },
});
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
          <group rotation={[0, 0, Math.PI / 2]}>
            <UnskewedFlatVideoMesh />
            {<GCodeVisualizer />}
          </group>
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
    <group position={[-offsetX, -offsetY, -100]}>
      <UnskewedVideoMesh matrix={videoToMachineHomography} matrixAutoUpdate={false} />
    </group>
  );
}
