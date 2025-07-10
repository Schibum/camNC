import { Svg } from '@react-three/drei';
import { useStore, useToolDiameter, useToolpathOpacity } from '@/store/store';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Vector3 } from 'three';
import { getZHeightColors } from './toolpathColors';

/**
 * Render the tool-path as an inline SVG using drei's <Svg> component.
 */
export function ToolpathSvgPlane() {
  const toolpath = useStore(s => s.toolpath);
  const toolDiameter = useToolDiameter();
  const toolpathOpacity = useToolpathOpacity();

  const bounds = toolpath?.getBounds();

  const origSize = React.useMemo(() => {
    if (!bounds) return null;
    const size = new Vector3();
    bounds.getSize(size);
    return size;
  }, [bounds]);

  const strokeMargin = toolDiameter / 2;

  const expandedSize = React.useMemo(() => {
    if (!origSize) return new Vector3(0, 0, 0);
    return new Vector3(origSize.x + 2 * strokeMargin, origSize.y + 2 * strokeMargin, origSize.z);
  }, [origSize, strokeMargin]);

  const svgString = React.useMemo(() => {
    if (!toolpath || !bounds) return '';

    const width = expandedSize.x;
    const height = expandedSize.y;
    const offsetX = bounds.min.x - strokeMargin;
    const offsetY = bounds.min.y - strokeMargin;

    const colors = getZHeightColors(toolpath);
    return renderToStaticMarkup(
      <ToolpathSvgContent
        width={width}
        height={height}
        offsetX={offsetX}
        offsetY={offsetY}
        colors={colors}
        pathPoints={toolpath.pathPoints}
        toolDiameter={toolDiameter}
      />
    );
  }, [toolpath, bounds, expandedSize, strokeMargin, toolDiameter]);

  if (!expandedSize || !svgString) return null;

  return (
    <Svg
      src={svgString}
      skipFill
      strokeMaterial={{ transparent: toolpathOpacity < 1, opacity: toolpathOpacity }}
      position={[expandedSize.x / 2 + (bounds!.min.x - strokeMargin), expandedSize.y / 2 + (bounds!.min.y - strokeMargin), bounds!.min.z]}
      renderOrder={50}
    />
  );
}

interface ToolpathSvgContentProps {
  width: number;
  height: number;
  offsetX: number;
  offsetY: number;
  colors: number[];
  pathPoints: Vector3[];
  toolDiameter: number;
}

function ToolpathSvgContent({ width, height, offsetX, offsetY, colors, pathPoints, toolDiameter }: ToolpathSvgContentProps) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      {pathPoints.slice(1).map((p1, idx) => {
        const p0 = pathPoints[idx];
        const x0 = p0.x - offsetX;
        const y0 = height - (p0.y - offsetY);
        const x1 = p1.x - offsetX;
        const y1 = height - (p1.y - offsetY);
        const r = Math.floor(colors[idx * 3] * 255);
        const g = Math.floor(colors[idx * 3 + 1] * 255);
        const b = Math.floor(colors[idx * 3 + 2] * 255);
        return (
          <line
            key={idx}
            x1={x0}
            y1={y0}
            x2={x1}
            y2={y1}
            stroke={`rgb(${r},${g},${b})`}
            strokeWidth={toolDiameter}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        );
      })}
    </svg>
  );
}
