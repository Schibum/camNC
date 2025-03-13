import { useMemo, useState } from 'react';
import * as THREE from 'three';
import colormap from 'colormap';
import {
  extractToolsFromGCode,
  parseGCode,
  groupSegmentsByTool,
  createToolpathGeometries,
} from './gcodeHelpers';

export function useGCodeProcessing(gcode: string) {
  const [error, setError] = useState<string | null>(null);

  // Extract tool information from the GCode comments
  const tools = useMemo(() => extractToolsFromGCode(gcode), [gcode]);

  // Parse the GCode and extract the toolpath
  const {
    toolpathSegments,
    bounds,
    error: parseError,
  } = useMemo(() => {
    const result = parseGCode(gcode);
    if (result.error) {
      setError(result.error);
    } else {
      setError(null);
    }
    return result;
  }, [gcode]);

  // Group segments by tool and motion type for optimization
  const segmentsByTool = useMemo(() => groupSegmentsByTool(toolpathSegments), [toolpathSegments]);

  // Create toolpath geometries for each tool and motion type
  const toolpathGeometries = useMemo(
    () => createToolpathGeometries(segmentsByTool, tools),
    [segmentsByTool, tools]
  );

  // Get unique z-heights from the geometries for the legend
  const zHeights = useMemo(() => {
    const heights = new Set<number>();

    Object.values(toolpathGeometries).forEach(geometriesByType => {
      [...geometriesByType.rapid, ...geometriesByType.cutting].forEach(geometry => {
        if (geometry.userData?.zHeight !== undefined) {
          heights.add(geometry.userData.zHeight);
        }
      });
    });

    return Array.from(heights).sort((a, b) => a - b);
  }, [toolpathGeometries]);

  // Get unique z-heights from cutting toolpaths only for colormap scaling
  const cuttingZHeights = useMemo(() => {
    const heights = new Set<number>();

    Object.values(toolpathGeometries).forEach(geometriesByType => {
      geometriesByType.cutting.forEach(geometry => {
        if (geometry.userData?.zHeight !== undefined) {
          heights.add(geometry.userData.zHeight);
        }
      });
    });

    return Array.from(heights).sort((a, b) => a - b);
  }, [toolpathGeometries]);

  // Generate plasma colormap for z-heights
  const zColorMap = useMemo(() => {
    if (cuttingZHeights.length <= 1) {
      return [{ r: 128, g: 0, b: 128 }]; // Default purple if only one height
    }

    // Generate colors using the plasma colormap
    const colors = colormap({
      colormap: 'plasma',
      nshades: 50,
      format: 'rgba', // Use rgba format which is compatible with the type definitions
      alpha: 1,
    });

    // Convert to the format we need (r, g, b properties)
    return colors.map(color => {
      // For rgba format, colormap returns arrays of [r, g, b, a]
      if (Array.isArray(color)) {
        return { r: color[0], g: color[1], b: color[2] };
      }
      // Fallback (should not happen with rgba format)
      return { r: 128, g: 0, b: 128 };
    });
  }, [cuttingZHeights]);

  // Function to get color for a specific z-height
  const getColorForZ = (zHeight: number) => {
    if (cuttingZHeights.length <= 1 || !zHeight) return new THREE.Color('rgb(128, 0, 128)');

    // Use the cutting-only z-height range for color mapping
    const minZ = cuttingZHeights[0];
    const maxZ = cuttingZHeights[cuttingZHeights.length - 1];
    const zRange = maxZ - minZ;

    // Calculate normalized position in range
    const normalizedPos = Math.max(0, Math.min(1, (zHeight - minZ) / zRange));

    // Map to colormap index
    const colorIndex = Math.floor(normalizedPos * (zColorMap.length - 1));
    const color = zColorMap[colorIndex];

    // Convert to THREE.Color
    return new THREE.Color(`rgb(${color.r}, ${color.g}, ${color.b})`);
  };

  return {
    error,
    tools,
    bounds,
    toolpathGeometries,
    zHeights,
    cuttingZHeights,
    getColorForZ,
  };
}
