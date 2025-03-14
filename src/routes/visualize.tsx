import { UnskewedVideoMesh } from '@/calibration/UnskewTsl';
import { createFileRoute } from '@tanstack/react-router';
import {
  useMachineSize,
  useVideoToMachineHomography,
  useToolDiameter,
  useSetToolDiameter,
  useStore,
} from '../store';
import { GCodeSelector } from '@/visualize/GCodeSelector';
import { GCodeVisualizer } from '@/visualize/GCodeVisualizer';
import { useState, useMemo, useEffect } from 'react';
import { sampleGcode, bookShelf } from '@/test_data/gcode';
import { PresentCanvas } from '@/scene/PresentCanvas';

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
});

function VisualizeComponent() {
  const renderSize = useMachineSize();
  const [showGCode, setShowGCode] = useState(true);
  const [showRapidMoves, setShowRapidMoves] = useState(false);
  const [showCuttingMoves, setShowCuttingMoves] = useState(true);
  const [selectedGCode, setSelectedGCode] = useState<string>(gcodeOptions[1].gcode);
  const toolDiameter = useToolDiameter();
  const setToolDiameter = useSetToolDiameter();
  const updateToolpath = useStore(s => s.updateToolpath);

  // Extract basic information from GCode
  const gcodeInfo = useMemo(() => {
    const toolsMatch = selectedGCode.match(/[;(]\s*Tools Table:/);
    const toolsSection = toolsMatch ? selectedGCode.substring(toolsMatch.index!) : '';
    const tools = toolsSection.match(/[;(]\s*T\d+\s+D=[\d.]+/g) || [];

    const rangesMatch = selectedGCode.match(/[;(]\s*Ranges Table:/);
    const rangesSection = rangesMatch ? selectedGCode.substring(rangesMatch.index!) : '';
    const ranges = {
      x: rangesSection.match(/X:\s*Min=([\d.-]+)\s*Max=([\d.-]+)/),
      y: rangesSection.match(/Y:\s*Min=([\d.-]+)\s*Max=([\d.-]+)/),
      z: rangesSection.match(/Z:\s*Min=([\d.-]+)\s*Max=([\d.-]+)/),
    };

    return {
      tools: tools.map(t => t.trim()),
      size: {
        x: ranges.x ? `${ranges.x[1]} to ${ranges.x[2]}` : 'Unknown',
        y: ranges.y ? `${ranges.y[1]} to ${ranges.y[2]}` : 'Unknown',
        z: ranges.z ? `${ranges.z[1]} to ${ranges.z[2]}` : 'Unknown',
      },
    };
  }, [selectedGCode]);

  useEffect(() => {
    updateToolpath(selectedGCode);
  }, [selectedGCode, updateToolpath]);

  const handleGCodeChange = (gcode: string) => {
    setSelectedGCode(gcode);
  };

  return (
    <div className="p-2">
      <div className="mb-4 flex flex-col space-y-2">
        {/* Toggle for GCode visibility */}
        <div className="flex items-center space-x-4">
          <label className="flex items-center space-x-2">
            <input
              type="checkbox"
              checked={showGCode}
              onChange={() => setShowGCode(!showGCode)}
              className="h-4 w-4"
            />
            <span>Show GCode Toolpath</span>
          </label>

          {showGCode && (
            <>
              <label className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  checked={showRapidMoves}
                  onChange={e => setShowRapidMoves(e.target.checked)}
                  className="h-4 w-4"
                />
                <span>Show Rapid Moves (G0)</span>
              </label>

              <label className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  checked={showCuttingMoves}
                  onChange={e => setShowCuttingMoves(e.target.checked)}
                  className="h-4 w-4"
                />
                <span>Show Cutting Moves (G1/G2/G3)</span>
              </label>

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
          )}
        </div>

        {/* GCode selection and information panel */}
        {showGCode && (
          <div className="flex flex-col space-y-2">
            <GCodeSelector onChange={handleGCodeChange} />

            {/* GCode info panel */}
            <div className="p-2 bg-gray-100 rounded-md text-xs">
              <h3 className="font-bold mb-1">GCode Information:</h3>
              <div className="grid grid-cols-2 gap-1">
                <div>
                  <span className="font-semibold">X Range:</span> {gcodeInfo.size.x}
                </div>
                <div>
                  <span className="font-semibold">Y Range:</span> {gcodeInfo.size.y}
                </div>
                <div>
                  <span className="font-semibold">Z Range:</span> {gcodeInfo.size.z}
                </div>
                <div>
                  <span className="font-semibold">Tools:</span> {gcodeInfo.tools.length}
                </div>
              </div>
              {gcodeInfo.tools.length > 0 && (
                <div className="mt-1">
                  <span className="font-semibold">Tool Info:</span>
                  <ul className="list-disc pl-5 mt-1">
                    {gcodeInfo.tools.map((tool, index) => (
                      <li key={index}>{tool.replace(/[;(]/, '')}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* 3D Canvas */}
      <div className="w-screen h-screen">
        <PresentCanvas worldScale="machine">
          <color attach="background" args={[0x1111ff]} />
          <group rotation={[0, 0, Math.PI / 2]}>
            <UnskewedFlatVideoMesh />
            {showGCode && <GCodeVisualizer />}
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
