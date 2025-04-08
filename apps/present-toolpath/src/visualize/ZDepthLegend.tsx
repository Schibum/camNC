import React, { useMemo } from 'react';
import colormap from 'colormap';
import { useStore } from '../store';
import { Box3 } from 'three';

// Use the same colormap as in Toolpaths.tsx
const plasmamap = colormap({
  colormap: 'plasma',
  nshades: 50,
  format: 'rgba',
  alpha: 1,
});

/**
 * Formats a number to a fixed number of decimal places
 * and removes trailing zeros
 */
function formatNumber(value: number, decimals = 2): string {
  return value.toFixed(decimals).replace(/\.?0+$/, '');
}

function ZDepthLegendForBounds({ bounds }: { bounds: Box3 }) {
  const minZ = bounds.min.z;
  const maxZ = bounds.max.z;

  // Generate intermediate values for tick marks (3 intermediate values)
  const intermediateValues = useMemo(() => {
    const range = maxZ - minZ;
    return [minZ + range * 0.25, minZ + range * 0.5, minZ + range * 0.75];
  }, [minZ, maxZ]);

  // Generate the gradient colors for the legend
  const gradientColors = plasmamap
    .map((color, i) => {
      const rgba = `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${color[3]})`;
      return `${rgba} ${(i / (plasmamap.length - 1)) * 100}%`;
    })
    .join(', ');

  return (
    <div className="z-depth-legend">
      <div className="text-center font-bold text-sm mb-3">Z Depth Visualization</div>
      <div className="flex flex-col w-full px-2">
        <div
          className="h-8 w-full rounded-md shadow-inner relative"
          style={{
            background: `linear-gradient(to right, ${gradientColors})`,
            border: '1px solid rgba(0,0,0,0.1)',
          }}
        >
          {/* Tick marks for intermediate values */}
          {intermediateValues.map((value, index) => {
            const position = ((value - minZ) / (maxZ - minZ)) * 100;
            return (
              <div
                key={index}
                className="absolute top-full h-2 border-l border-gray-400"
                style={{ left: `${position}%` }}
              />
            );
          })}
        </div>

        {/* Value labels */}
        <div className="flex justify-between mt-2 text-xs">
          <div className="text-left font-medium">
            <span>{formatNumber(minZ)} mm</span>
            <div className="text-gray-500 text-[10px]">Max Depth</div>
          </div>

          {intermediateValues.map((value, index) => (
            <div key={index} className="text-center">
              <span>{formatNumber(value)}</span>
            </div>
          ))}

          <div className="text-right font-medium">
            <span>{formatNumber(maxZ)} mm</span>
            <div className="text-gray-500 text-[10px]">Min Depth</div>
          </div>
        </div>
      </div>
    </div>
  );
}
/**
 * Component to display a z-depth color legend
 */
export const ZDepthLegend: React.FC = () => {
  const toolpath = useStore(s => s.toolpath);
  if (!toolpath) {
    return null;
  }
  return <ZDepthLegendForBounds bounds={toolpath.getBounds()} />;
};
