import { useMemo } from 'react';
import { useToolDiameter } from '@/store';
import { createToolpathGeometries, ToolpathSegment } from './gcodeHelpers';

/**
 * Hook to create geometries from parsed GCode segments
 */
export function useToolpathGeometries(
  segmentsByTool: Record<number, { rapid: ToolpathSegment[]; cutting: ToolpathSegment[] }>
) {
  // Get tool diameter directly from store
  const toolDiameter = useToolDiameter();

  // Create toolpath geometries for each tool and motion type
  const toolpathGeometries = useMemo(
    () => createToolpathGeometries(segmentsByTool, toolDiameter),
    [segmentsByTool, toolDiameter]
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

  return {
    toolpathGeometries,
    zHeights,
    cuttingZHeights,
  };
}
