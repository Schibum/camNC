import { useMemo } from 'react';
import * as THREE from 'three';
import colormap from 'colormap';

/**
 * Hook to create a color mapping function for z-heights
 */
export function useColorMapping(cuttingZHeights: number[]) {
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
  const getColorForZ = useMemo(() => {
    return (zHeight: number) => {
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
  }, [cuttingZHeights, zColorMap]);

  return { getColorForZ };
}
