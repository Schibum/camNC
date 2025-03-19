import { AppRoot } from '@/components/app-root';
import { NavFluidnc } from '@/components/fluidnc/NavFluidnc';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SidebarGroup, SidebarGroupLabel, SidebarGroupContent } from '@/components/ui/sidebar';
import { useSetToolDiameter, useStore, useToolDiameter } from '@/store';
import { bookShelf, sampleGcode } from '@/test_data/gcode';
import { BoundsInfo } from '@/visualize/BoundsInfo';
import { FileSelector } from '@/visualize/FileSelector';
import { GCodeSelector } from '@/visualize/GCodeSelector';
import { ZDepthLegend } from '@/visualize/ZDepthLegend';
import { createFileRoute, Outlet } from '@tanstack/react-router';
import { useState, useEffect } from 'react';

export const Route = createFileRoute('/visualize')({
  component: RouteComponent,
});

interface GCodeOption {
  name: string;
  gcode: string;
}
const gcodeOptions: GCodeOption[] = [
  { name: 'Sample GCode (Eichenbox)', gcode: sampleGcode },
  { name: 'Book Shelf', gcode: bookShelf },
];

function SidebarExtraContent() {
  const toolDiameter = useToolDiameter();
  const setToolDiameter = useSetToolDiameter();

  const [selectedGCode, setSelectedGCode] = useState<string>(gcodeOptions[1].gcode);
  const updateToolpath = useStore(s => s.updateToolpath);

  useEffect(() => {
    updateToolpath(selectedGCode);
  }, [selectedGCode, updateToolpath]);

  const handleGCodeChange = (gcode: string) => {
    setSelectedGCode(gcode);
  };

  return (
    <>
      <NavFluidnc />
      <SidebarGroup>
        <SidebarGroupLabel>Visualization</SidebarGroupLabel>
        <SidebarGroupContent>
          <div className="flex flex-col space-y-2">
            <GCodeSelector onChange={handleGCodeChange} />
            <FileSelector />
            <BoundsInfo />

            {
              <>
                <div className="grid w-full max-w-sm items-center gap-1.5">
                  <Label htmlFor="email">Tool Diameter (mm)</Label>
                  <Input
                    type="number"
                    min="0.1"
                    max="50"
                    step="0.1"
                    value={toolDiameter}
                    onChange={e => setToolDiameter(parseFloat(e.target.value))}
                  />
                </div>
              </>
            }

            {/* GCode selection and information panel */}
            <ZDepthLegend />
          </div>
        </SidebarGroupContent>
      </SidebarGroup>
    </>
  );
}

function RouteComponent() {
  return (
    <>
      <AppRoot extraSidebarContent={<SidebarExtraContent />}>
        <Outlet />
      </AppRoot>
    </>
  );
}
