import { Draggable } from '@/scene/Draggable';
import { animated, useSpring } from '@react-spring/three';
import { Edges, Line, Plane } from '@react-three/drei';
import { ThreeEvent, useThree } from '@react-three/fiber';
import colormap from 'colormap';
import React, { useMemo } from 'react';
import { Color, SRGBColorSpace, Vector2, Vector3 } from 'three';
import { Line2, LineGeometry, LineMaterial } from 'three/addons';
import { useStore, useToolDiameter } from '../store/store';
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
    const mat = new LineMaterial({
      color: 0xffffff,
      vertexColors: true,
      alphaToCoverage: false,
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

interface GCodeVisualizerProps {}
export const GCodeVisualizer: React.FC<GCodeVisualizerProps> = () => {
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
          <Toolpaths />
          <ToolpathBackgroundPlane />
          <LineAxesHelper size={50} position-z={150} visible={isToolpathHovered} />
        </group>
      </Draggable>
    </>
  );
};
