import { Draggable } from '@/scene/Draggable';
import { animated, useSpring } from '@react-spring/three';
import { Edges, Line, Plane } from '@react-three/drei';
import { ThreeEvent, useThree } from '@react-three/fiber';
import colormap from 'colormap';
import React, { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { CanvasTexture, Color, DoubleSide, SRGBColorSpace, Vector2, Vector3 } from 'three';
import { Line2, LineGeometry, LineMaterial } from 'three/addons';
import { useStore, useToolDiameter, useToolpathOpacity } from '../store/store';
import { ParsedToolpath } from './gcodeParsing';
import { LineAxesHelper } from './LineAxesHelper';

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
    const color = getPlasmaColor((toolpath.pathPoints[i].z - boundingBox.min.z) / (boundingBox.max.z - boundingBox.min.z));

    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }
  return colors;
}

/*
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
*/

// Using ToolpathCanvasPlane instead for now.
export const Toolpaths: React.FC = () => {
  const toolpath = useStore(s => s.toolpath);
  const toolDiameter = useToolDiameter();
  const toolpathOpacity = useToolpathOpacity();
  const viewport = useThree(s => s.viewport);

  const line2 = useMemo(() => {
    if (!toolpath) return null;
    const geom = new LineGeometry();
    geom.setPositions(toolpath.pathPoints.flatMap(p => [p.x, p.y, -p.z]));
    const mat = new LineMaterial({
      color: 0xffffff,
      vertexColors: true,
      alphaToCoverage: false,
      transparent: true,
    });
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

  useEffect(() => {
    if (line2) {
      const mat = line2.material as LineMaterial;
      mat.transparent = toolpathOpacity < 1;
      mat.opacity = toolpathOpacity;
      mat.needsUpdate = true;
    }
  }, [line2, toolpathOpacity]);
  if (!line2) return null;

  return (
    <>
      <primitive object={line2} />
    </>
  );
};

const AnimatedPlane = animated(Plane);

function ToolpathBackgroundPlane() {
  const isToolpathHovered = useStore(s => s.isToolpathHovered);
  const toolpath = useStore(s => s.toolpath);
  const { opacity } = useSpring({ opacity: isToolpathHovered ? 0.05 : 0.02 });
  const bounds = toolpath?.getBounds();
  const boundingSize = useMemo(() => {
    if (!bounds) return null;
    const size = new Vector3();
    bounds.getSize(size);
    return size;
  }, [bounds]);

  if (!boundingSize || !bounds) return null;

  return (
    <group>
      <AnimatedPlane
        args={[boundingSize.x, boundingSize.y]}
        position={[boundingSize.x / 2 + bounds.min.x, boundingSize.y / 2 + bounds.min.y, bounds.min.z]}
        material-color="white"
        material-transparent={true}
        material-opacity={opacity}>
        <Edges
          position={[0, 0, 0]}
          linewidth={1}
          color="white"
          depthTest={false}
          renderOrder={100}
          dashed
          dashSize={10}
          gapSize={10}
          visible={isToolpathHovered}
        />
      </AnimatedPlane>
    </group>
  );
}

function UseableMachineSpaceOutline() {
  const machineBounds = useStore(s => s.camSource!.machineBounds!);
  const corners = useMemo(() => {
    return [
      [machineBounds.min.x, machineBounds.min.y],
      [machineBounds.min.x, machineBounds.max.y],
      [machineBounds.max.x, machineBounds.max.y],
      [machineBounds.max.x, machineBounds.min.y],
      [machineBounds.min.x, machineBounds.min.y],
    ] as [number, number][];
  }, [machineBounds]);
  return <Line depthTest={false} renderOrder={1000} points={corners} color="#0cd20c" linewidth={1} dashed dashSize={5} gapSize={5} />;
}

/**
 * Render the tool-path into a plain 2-D <canvas> using the 2-D context.
 * The canvas becomes a `THREE.CanvasTexture` that we map onto a plane.
 * This guarantees exactly one fragment per pixel → no alpha accumulation.
 */
function ToolpathCanvasPlane() {
  const toolpath = useStore(s => s.toolpath);
  const toolDiameter = useToolDiameter();
  const toolpathOpacity = useToolpathOpacity();

  const bounds = toolpath?.getBounds();

  // Original bounding size (without stroke thickness)
  const origSize = React.useMemo(() => {
    if (!bounds) return null;
    const size = new Vector3();
    bounds.getSize(size);
    return size;
  }, [bounds]);

  // Add a margin equal to half the tool diameter so wide strokes aren't clipped
  const strokeMargin = toolDiameter / 2; // world-units

  const expandedSize = React.useMemo(() => {
    if (!origSize) return null;
    return new Vector3(origSize.x + 2 * strokeMargin, origSize.y + 2 * strokeMargin, origSize.z);
  }, [origSize, strokeMargin]);

  // Draw tool-path onto <canvas>
  const [texture] = React.useState(() => new CanvasTexture(document.createElement('canvas')));

  React.useEffect(() => {
    if (!toolpath || !expandedSize) return;

    const DPR = window.devicePixelRatio || 1;
    const BASE_PX_PER_UNIT = 5 * DPR * 2; // 2× supersampling on top of DPR

    const MAX_TEX = 16384; // conservative WebGL2 limit
    const pxPerUnit = Math.max(1, Math.min(BASE_PX_PER_UNIT, MAX_TEX / expandedSize.x, MAX_TEX / expandedSize.y));
    console.log('pxPerUnit', pxPerUnit);

    const width = Math.ceil(expandedSize.x * pxPerUnit);
    const height = Math.ceil(expandedSize.y * pxPerUnit);

    let canvas = texture.image as HTMLCanvasElement;
    // Recreate texture if dimensions changed (grow OR shrink) to avoid residual pixels
    if (canvas.width !== width || canvas.height !== height) {
      // Dispose old GPU texture
      texture.dispose();
      canvas = document.createElement('canvas');
      (texture as any).image = canvas; // mutate texture image reference
    }
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d')!;

    // Enable smoother scaling if texture is magnified
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;

    ctx.imageSmoothingEnabled = true;

    // Clear
    ctx.clearRect(0, 0, width, height);

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = toolDiameter * pxPerUnit;

    const colors = getZHeightColors(toolpath);

    // Build list of segment indices with avg-z to sort by z descending
    const segments = [] as { idx: number; z: number }[];
    for (let i = 1; i < toolpath.pathPoints.length; i++) {
      const z = (toolpath.pathPoints[i - 1].z + toolpath.pathPoints[i].z) / 2;
      segments.push({ idx: i, z });
    }
    segments.sort((a, b) => b.z - a.z); // highest z first

    for (const { idx: i } of segments) {
      // Per-vertex colour (use color of starting vertex)
      const r = colors[(i - 1) * 3];
      const g = colors[(i - 1) * 3 + 1];
      const b = colors[(i - 1) * 3 + 2];

      ctx.strokeStyle = `rgb(${Math.floor(r * 255)}, ${Math.floor(g * 255)}, ${Math.floor(b * 255)})`;

      const p0 = toolpath.pathPoints[i - 1];
      const p1 = toolpath.pathPoints[i];

      ctx.beginPath();
      ctx.moveTo(
        Math.round((p0.x - (bounds!.min.x - strokeMargin)) * pxPerUnit),
        Math.round((expandedSize.y - (p0.y - (bounds!.min.y - strokeMargin))) * pxPerUnit)
      );
      ctx.lineTo(
        Math.round((p1.x - (bounds!.min.x - strokeMargin)) * pxPerUnit),
        Math.round((expandedSize.y - (p1.y - (bounds!.min.y - strokeMargin))) * pxPerUnit)
      );
      ctx.stroke();
    }

    texture.needsUpdate = true;
  }, [toolpath, expandedSize, toolDiameter, texture, bounds, strokeMargin]);

  if (!expandedSize) return null;

  return (
    <mesh
      position={[expandedSize.x / 2 + (bounds!.min.x - strokeMargin), expandedSize.y / 2 + (bounds!.min.y - strokeMargin), bounds!.min.z]}
      renderOrder={50}>
      <planeGeometry args={[expandedSize.x, expandedSize.y]} />
      <meshBasicMaterial map={texture} transparent opacity={toolpathOpacity} side={DoubleSide} />
    </mesh>
  );
}

export const GCodeVisualizer: React.FC = () => {
  const toolpath = useStore(s => s.toolpath);
  const setIsToolpathSelected = useStore(s => s.setIsToolpathSelected);
  const setIsToolpathHovered = useStore(s => s.setIsToolpathHovered);
  const setToolpathOffset = useStore(s => s.setToolpathOffset);
  const isToolpathHovered = useStore(s => s.isToolpathHovered);

  function onDragEnd(event: ThreeEvent<PointerEvent>) {
    setToolpathOffset(event.eventObject.position);
  }

  const boundingSize = useMemo(() => {
    const size = new Vector3();
    const bounds = toolpath?.getBounds();
    if (!bounds) return null;
    bounds.getSize(size);
    return size;
  }, [toolpath]);

  if (!boundingSize) return null;

  return (
    <>
      <LineAxesHelper size={100} position-z={1000} />
      <UseableMachineSpaceOutline />
      <Draggable onDragEnd={onDragEnd}>
        <group
          position-z={200}
          onPointerMissed={e => e.type === 'click' && setIsToolpathSelected(false)}
          onClick={e => (e.stopPropagation, setIsToolpathSelected(true))}
          onPointerEnter={() => setIsToolpathHovered(true)}
          onPointerLeave={() => setIsToolpathHovered(false)}>
          <ToolpathCanvasPlane />
          {/* <Toolpaths /> */}
          <ToolpathBackgroundPlane />
          <LineAxesHelper size={50} position-z={150} visible={isToolpathHovered} />
        </group>
      </Draggable>
    </>
  );
};
