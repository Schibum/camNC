import { useMachineSize } from '@/store';
import React, { useMemo } from 'react';
import { extractToolsFromGCode, parseGCode, groupSegmentsByTool } from './gcodeHelpers';
import { useToolpathGeometries } from './useToolpathGeometries';
import { useColorMapping } from './useColorMapping';
import { Toolpaths } from './Toolpaths';
import { ErrorMessage } from './ErrorMessage';

interface GCodeVisualizerProps {
  gcode: string;
  showRapidMoves: boolean;
  showCuttingMoves: boolean;
}

export const GCodeVisualizer: React.FC<GCodeVisualizerProps> = ({
  gcode,
  showRapidMoves,
  showCuttingMoves,
}) => {
  // Z scaling factor to make height differences more visible
  const zScaleFactor = 1;

  const machineSize = useMachineSize();
  const offsetX = machineSize[0] / 2;
  const offsetY = machineSize[1] / 2;

  // Use direct function calls with useMemo instead of wrapper hooks
  const tools = useMemo(() => extractToolsFromGCode(gcode), [gcode]);
  const parsedGCode = useMemo(() => parseGCode(gcode), [gcode]);
  const segmentsByTool = useMemo(
    () => groupSegmentsByTool(parsedGCode.toolpathSegments),
    [parsedGCode.toolpathSegments]
  );

  // Generate geometries from parsed GCode
  const { toolpathGeometries, cuttingZHeights } = useToolpathGeometries(segmentsByTool, tools);

  // Create color mapping function
  const { getColorForZ } = useColorMapping(cuttingZHeights);

  return (
    <group position={[-offsetX, -offsetY, 0.1]}>
      <ErrorMessage error={parsedGCode.error || null} />

      <Toolpaths
        toolpathGeometries={toolpathGeometries}
        tools={tools}
        zScaleFactor={zScaleFactor}
        getColorForZ={getColorForZ}
        showRapidMoves={showRapidMoves}
        showCuttingMoves={showCuttingMoves}
      />
    </group>
  );
};
