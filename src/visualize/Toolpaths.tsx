import colormap from 'colormap';
import React, { useMemo } from 'react';
import { Line2, LineGeometry, LineMaterial } from 'three/addons';
import { useStore, useToolDiameter } from '../store';
import { ParsedToolpath } from './gcodeHelpers';
import { useThree } from '@react-three/fiber';
import { Color, SRGBColorSpace, Vector2 } from 'three';

const plasmamap = colormap({
  colormap: 'plasma',
  nshades: 100,
  format: 'rgba',
  alpha: 1,
}).map(c => new Color().setRGB(c[0] / 255, c[1] / 255, c[2] / 255, SRGBColorSpace));

function getPlasmaColor(float: number) {
  return plasmamap[Math.floor(float * (plasmamap.length - 1))];
}

function getZHeightColors(toolpath: ParsedToolpath) {
  const boundingBox = toolpath.getBounds();
  const colors = new Array(toolpath.pathPoints.length * 3);
  for (let i = 0; i < toolpath.pathPoints.length; i++) {
    const color = getPlasmaColor(
      (toolpath.pathPoints[i].z - boundingBox.min.z) / (boundingBox.max.z - boundingBox.min.z)
    );

    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }
  return colors;
}

function getTimeColors(toolpath: ParsedToolpath) {
  const colors = new Array(toolpath.pathPoints.length * 3);
  for (let i = 0; i < toolpath.pathPoints.length; i++) {
    const color = getPlasmaColor(i / toolpath.pathPoints.length);
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }
  return colors;
}

export const Toolpaths: React.FC = () => {
  const toolpath = useStore(s => s.toolpath);
  const toolDiameter = useToolDiameter();
  const viewport = useThree(s => s.viewport);

  const line2 = useMemo(() => {
    if (!toolpath) return null;
    const geom = new LineGeometry();
    geom.setPositions(toolpath.pathPoints.flatMap(p => [p.x, p.y, -p.z]));
    const mat = new LineMaterial({ color: 0xffffff, vertexColors: true, alphaToCoverage: false });
    mat.linewidth = toolDiameter;
    mat.worldUnits = true;
    mat.resolution = new Vector2(viewport.width, viewport.height);
    const colors = getZHeightColors(toolpath);
    // const colors = getTimeColors(toolpath);
    geom.setColors(colors);

    const line = new Line2(geom, mat);
    line.computeLineDistances();

    return line;
  }, [toolpath, toolDiameter, viewport.width, viewport.height]);
  if (!line2) return null;

  return (
    <group>
      <>
        {/* Render the toolpath as a line using react-three/fiber */}
        <primitive object={line2} />
      </>
    </group>
  );
};
