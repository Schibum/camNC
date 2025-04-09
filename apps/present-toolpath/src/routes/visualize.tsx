import { AppRoot } from '@/components/app-root';
import { NavFluidnc } from '@/components/fluidnc/NavFluidnc';
import { useSetToolDiameter, useStore, useToolDiameter } from '@/store';
import { bookShelf, sampleGcode } from '@/test_data/gcode';
import { BoundsInfo } from '@/visualize/BoundsInfo';
import { FileSelector } from '@/visualize/FileSelector';
import { GCodeSelector } from '@/visualize/GCodeSelector';
import { ZDepthLegend } from '@/visualize/ZDepthLegend';
import { createFileRoute, Outlet } from '@tanstack/react-router';
import { NumberInputWithLabel } from '@wbcnc/ui/components/NumberInputWithLabel';
import { SidebarGroup, SidebarGroupContent, SidebarGroupLabel } from '@wbcnc/ui/components/sidebar';
import { useEffect, useState } from 'react';

export const Route = createFileRoute('/visualize')({
  component: RouteComponent,
});

function StockHeightInput() {
  const stockHeight = useStore(s => s.stockHeight);
  const setStockHeight = useStore(s => s.setStockHeight);
  return <NumberInputWithLabel label="Stock Height (mm)" value={stockHeight} onValueChange={value => value && setStockHeight(value)} />;
}

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

  const [selectedGCode, setSelectedGCode] = useState<string>(gcodeOptions[0].gcode);
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
            <StockHeightInput />
            <NumberInputWithLabel
              label="Tool Diameter (mm)"
              value={toolDiameter}
              onValueChange={value => value && setToolDiameter(value)}
              min={0.1}
            />
            <ZDepthLegend />
            <BoundsInfo />
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
