import { UnskewedVideoMesh } from '@/calibration/UnskewTsl';
import { PresentCanvas } from '@/scene/PresentCanvas';
import { bookShelf, sampleGcode } from '@/test_data/gcode';
import { GCodeVisualizer } from '@/visualize/GCodeVisualizer';
import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useMemo, useState } from 'react';
import {
  useMachineSize,
  useSetToolDiameter,
  useStore,
  useToolDiameter,
  useVideoToMachineHomography,
} from '../store';
import { BoundsInfo } from '@/visualize/BoundsInfo';
import { GCodeSelector } from '@/visualize/GCodeSelector';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
} from '@/components/ui/breadcrumb';
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarTrigger,
} from '@/components/ui/sidebar';
import { Separator } from '@radix-ui/react-separator';
import { ZDepthLegend } from '@/visualize/ZDepthLegend';
import { AppRoot } from '@/components/app-root';
interface GCodeOption {
  name: string;
  gcode: string;
}

const gcodeOptions: GCodeOption[] = [
  { name: 'Sample GCode (Eichenbox)', gcode: sampleGcode },
  { name: 'Book Shelf', gcode: bookShelf },
];

export const Route = createFileRoute('/visualize')({
  component: VisualizeComponent,
  beforeLoad: () => {
    return { customSidebar: true };
  },
});

function SidebarExtraContent() {
  const toolDiameter = useToolDiameter();
  const setToolDiameter = useSetToolDiameter();

  const [showGCode, setShowGCode] = useState(true);
  const [selectedGCode, setSelectedGCode] = useState<string>(gcodeOptions[1].gcode);
  const updateToolpath = useStore(s => s.updateToolpath);

  // Extract basic information from GCode
  const gcodeInfo = useMemo(() => {
    const toolsMatch = selectedGCode.match(/[;(]\s*Tools Table:/);
    const toolsSection = toolsMatch ? selectedGCode.substring(toolsMatch.index!) : '';
    const tools = toolsSection.match(/[;(]\s*T\d+\s+D=[\d.]+/g) || [];

    return {
      tools: tools.map(t => t.trim()),
    };
  }, [selectedGCode]);

  useEffect(() => {
    updateToolpath(selectedGCode);
  }, [selectedGCode, updateToolpath]);

  const handleGCodeChange = (gcode: string) => {
    setSelectedGCode(gcode);
  };

  return (
    <SidebarGroup>
      <SidebarGroupLabel>Visualization</SidebarGroupLabel>
      <SidebarGroupContent>
        <div className="flex flex-col space-y-2">
          <GCodeSelector onChange={handleGCodeChange} />
          {/* Toggle for GCode visibility */}
          <label className="flex-col items-center space-x-2">
            <input
              type="checkbox"
              checked={showGCode}
              onChange={() => setShowGCode(!showGCode)}
              className="h-4 w-4"
            />
            <span>Show GCode Toolpath</span>
          </label>
          <BoundsInfo />

          {
            <>
              <label className="flex items-center space-x-2">
                <span>Tool Diameter (mm):</span>
                <input
                  type="number"
                  min="0.1"
                  max="50"
                  step="0.1"
                  value={toolDiameter}
                  onChange={e => setToolDiameter(parseFloat(e.target.value))}
                  className="w-16 px-1 py-0 border rounded"
                />
              </label>
            </>
          }

          {/* GCode selection and information panel */}
          <ZDepthLegend />
        </div>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

function VisualizeComponent() {
  return (
    <AppRoot extraSidebarContent={<SidebarExtraContent />}>
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
    </AppRoot>
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
