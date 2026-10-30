import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Box2,
  BufferGeometry,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  LineBasicMaterial,
  LineSegments,
  PlaneGeometry,
  ShaderMaterial,
  Texture,
  Vector3,
} from 'three';
import { useToolDiameter } from '@/store/store';
import { getStockFootprint, isRapidSegment } from '../depthInspection';
import { useDepthView, useShowStockVideo } from '../depthViewStore';
import { ParsedToolpath } from '../gcodeParsing';
import { parseToolInfo } from '../guess-tools';
import { ToolPositionMarker } from '../DepthSceneParts';
import { kJobDoneColor } from '../jobProgress';
import { HeightmapStamper, heightmapSize } from './HeightmapStamper';
import { currentPlayhead } from './jobTimeline';
import { resolveToolShape } from './toolShapes';

const kStockColor = new Color('#c9a46e');
// Largest heightmap side, and the largest display grid side (vertices).
const kMaxHeightmapSize = 4096;
const kMaxGridSize = 768;

const kSurfaceVertex = /* glsl */ `
  uniform sampler2D uHeight;
  uniform vec2 uZRange; // low, top
  varying vec3 vPos;
  void main() {
    float z = mix(uZRange.x, uZRange.y, texture(uHeight, uv).r);
    vPos = vec3(position.xy, z);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(vPos, 1.0);
  }
`;

const kSurfaceFragment = /* glsl */ `
  uniform vec2 uZRange;
  uniform float uBottom;
  uniform float uZScale;
  uniform vec3 uColor;
  uniform bool uHideTop;
  uniform vec3 uBackground;
  varying vec3 vPos;

  void main() {
    // Cut through the stock: leave a hole. Uses the interpolated height, so hole edges follow the mesh.
    if (vPos.z <= uBottom + 1e-3) discard;
    vec3 scaled = vPos * vec3(1.0, 1.0, uZScale);
    vec3 n = normalize(cross(dFdx(scaled), dFdy(scaled)));
    if (n.z < 0.0) n = -n;
    vec3 light = normalize(vec3(-0.4, -0.6, 1.0));
    float diffuse = 0.4 + 0.6 * max(dot(n, light), 0.0);
    float top = uZRange.y;
    float depth = clamp((top - vPos.z) / max(top - uBottom, 1e-3), 0.0, 1.0);
    bool uncut = top - vPos.z < 1e-3;
    vec3 color = uncut ? uColor * 1.08 : uColor * (0.92 - depth * 0.35);
    // The camera image is blended over the uncut top: a dark top keeps it looking as without the simulation.
    if (uncut && uHideTop) {
      gl_FragColor = vec4(uBackground, 1.0);
      #include <colorspace_fragment>
      return;
    }
    gl_FragColor = vec4(color * diffuse, 1.0);
    #include <colorspace_fragment>
  }
`;

const kWallVertex = /* glsl */ `
  uniform sampler2D uHeight;
  uniform vec2 uZRange;
  uniform float uBottom;
  uniform vec2 uFrom; // uv of the edge start
  uniform vec2 uTo;
  uniform vec4 uFootprint; // min x, min y, size x, size y
  attribute vec2 edge; // x: along the edge 0..1, y: 0 bottom, 1 top
  varying float vTop;
  void main() {
    vec2 uv = mix(uFrom, uTo, edge.x);
    float top = mix(uZRange.x, uZRange.y, texture(uHeight, uv).r);
    vTop = top;
    vec2 xy = uFootprint.xy + uv * uFootprint.zw;
    float z = edge.y > 0.5 ? max(top, uBottom) : uBottom;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(xy, z, 1.0);
  }
`;

const kWallFragment = /* glsl */ `
  uniform float uBottom;
  uniform vec3 uColor;
  varying float vTop;
  void main() {
    if (vTop <= uBottom + 1e-3) discard;
    gl_FragColor = vec4(uColor, 1.0);
    #include <colorspace_fragment>
  }
`;

// Walls along the four stock edges, in uv, with the shading of each side.
const kWalls: { from: [number, number]; to: [number, number]; shade: number }[] = [
  { from: [0, 0], to: [1, 0], shade: 0.78 }, // front (-Y)
  { from: [1, 0], to: [1, 1], shade: 0.66 }, // +X
  { from: [1, 1], to: [0, 1], shade: 0.55 }, // back (+Y)
  { from: [0, 1], to: [0, 0], shade: 0.7 }, // -X
];

function wallGeometry(segments: number) {
  const geom = new BufferGeometry();
  const edge: number[] = [];
  const index: number[] = [];
  for (let i = 0; i <= segments; i++) {
    edge.push(i / segments, 0, i / segments, 1);
    if (i < segments) {
      const k = i * 2;
      index.push(k, k + 2, k + 1, k + 1, k + 2, k + 3);
    }
  }
  geom.setAttribute('edge', new Float32BufferAttribute(edge, 2));
  // Bounds only, positions come from the heightmap.
  geom.setAttribute('position', new Float32BufferAttribute(new Array((segments + 1) * 2 * 3).fill(0), 3));
  geom.setIndex(index);
  return geom;
}

/**
 * The stock with the material the job removes up to the timeline's playhead, in toolpath coordinates (Z with the
 * Z0 placement already applied by the parent: `zTop` is the stock top in toolpath Z).
 */
export function SimulatedStock({ toolpath, zTop, stockHeight }: { toolpath: ParsedToolpath; zTop: number; stockHeight: number }) {
  const gl = useThree(s => s.gl);
  const toolDiameter = useToolDiameter();
  const toolShape = useDepthView(s => s.toolShape);
  const zScale = useDepthView(s => s.zScale);
  const showVideo = useShowStockVideo();
  const tools = useMemo(() => parseToolInfo(toolpath.gcode), [toolpath]);
  const footprint = useMemo(() => getStockFootprint(toolpath), [toolpath]);
  const bounds = toolpath.getBounds();
  // Without a stock height, the stock ends just below the deepest cut.
  const height = stockHeight > 0 ? stockHeight : Math.max(zTop - bounds.min.z + 1, 1);
  const bottom = zTop - height;
  const zLow = Math.min(bottom, bounds.min.z) - 1;

  const stamper = useMemo(() => {
    const size = heightmapSize(footprint, Math.min(kMaxHeightmapSize, gl.capabilities.maxTextureSize));
    return new HeightmapStamper(toolpath, { footprint, zTop, zLow, width: size.width, height: size.height }, tool =>
      resolveToolShape(tool, tools, toolDiameter, toolShape)
    );
  }, [toolpath, footprint, zTop, zLow, tools, toolDiameter, toolShape, gl]);
  useEffect(() => () => stamper.dispose(), [stamper]);

  useFrame(() => stamper.update(gl, currentPlayhead(toolpath)));

  return (
    <>
      <StockSurface
        texture={stamper.depthTexture}
        footprint={footprint}
        size={stamper.domain}
        zLow={zLow}
        zTop={zTop}
        bottom={bottom}
        zScale={zScale}
        showVideo={showVideo}
      />
      <ToolpathLines toolpath={toolpath} />
    </>
  );
}

function StockSurface({
  texture,
  footprint,
  size,
  zLow,
  zTop,
  bottom,
  zScale,
  showVideo,
}: {
  texture: Texture;
  footprint: Box2;
  size: { width: number; height: number };
  zLow: number;
  zTop: number;
  bottom: number;
  zScale: number;
  showVideo: boolean;
}) {
  const sizeX = footprint.max.x - footprint.min.x;
  const sizeY = footprint.max.y - footprint.min.y;
  const gridX = Math.min(size.width, kMaxGridSize);
  const gridY = Math.min(size.height, kMaxGridSize);
  const surfaceGeometry = useMemo(() => new PlaneGeometry(sizeX, sizeY, gridX, gridY), [sizeX, sizeY, gridX, gridY]);
  const wall = useMemo(() => wallGeometry(Math.max(gridX, gridY)), [gridX, gridY]);
  useEffect(() => () => surfaceGeometry.dispose(), [surfaceGeometry]);
  useEffect(() => () => wall.dispose(), [wall]);

  const surface = useMemo(
    () =>
      new ShaderMaterial({
        vertexShader: kSurfaceVertex,
        fragmentShader: kSurfaceFragment,
        uniforms: {
          uHeight: { value: null },
          uZRange: { value: [0, 0] },
          uBottom: { value: 0 },
          uZScale: { value: 1 },
          uColor: { value: kStockColor.clone() },
          uHideTop: { value: false },
          uBackground: { value: new Color('#161b24') },
        },
        side: DoubleSide,
      }),
    []
  );
  const walls = useMemo(
    () =>
      kWalls.map(
        ({ from, to, shade }) =>
          new ShaderMaterial({
            vertexShader: kWallVertex,
            fragmentShader: kWallFragment,
            uniforms: {
              uHeight: { value: null },
              uZRange: { value: [0, 0] },
              uBottom: { value: 0 },
              uFrom: { value: from },
              uTo: { value: to },
              uFootprint: { value: [0, 0, 0, 0] },
              uColor: { value: kStockColor.clone().multiplyScalar(shade) },
            },
            side: DoubleSide,
          })
      ),
    []
  );
  useEffect(() => () => [surface, ...walls].forEach(m => m.dispose()), [surface, walls]);

  useEffect(() => {
    for (const material of [surface, ...walls]) {
      material.uniforms.uHeight.value = texture;
      material.uniforms.uZRange.value = [zLow, zTop];
      material.uniforms.uBottom.value = bottom;
    }
    surface.uniforms.uZScale.value = zScale;
    surface.uniforms.uHideTop.value = showVideo;
    for (const material of walls) material.uniforms.uFootprint.value = [footprint.min.x, footprint.min.y, sizeX, sizeY];
  }, [surface, walls, texture, zLow, zTop, bottom, size, sizeX, sizeY, zScale, footprint, showVideo]);

  const center: [number, number, number] = [(footprint.min.x + footprint.max.x) / 2, (footprint.min.y + footprint.max.y) / 2, 0];
  return (
    <>
      <mesh geometry={surfaceGeometry} material={surface} position={center} raycast={() => null} frustumCulled={false} />
      {walls.map((material, i) => (
        <mesh key={i} geometry={wall} material={material} raycast={() => null} frustumCulled={false} />
      ))}
    </>
  );
}

/** The toolpath as thin lines: ahead of the playhead in light blue, the part already done in a dimmer green. */
function ToolpathLines({ toolpath }: { toolpath: ParsedToolpath }) {
  const showRapids = useDepthView(s => s.showRapids);
  const { ahead, done } = useMemo(() => {
    const points = toolpath.pathPoints;
    // Slot i - 1 holds the segment ending at point i, so the draw ranges can split at the playhead.
    const positions = new Float32Array(Math.max(points.length - 1, 0) * 6);
    const colors = new Float32Array(positions.length);
    const cut = new Color('#7dd3fc');
    const rapid = new Color('#94a3b8');
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1];
      const isRapid = isRapidSegment(toolpath, i);
      // Hidden rapids stay in their slot as zero-length lines.
      const b = isRapid && !showRapids ? a : points[i];
      positions.set([a.x, a.y, a.z, b.x, b.y, b.z], (i - 1) * 6);
      const c = isRapid ? rapid : cut;
      colors.set([c.r, c.g, c.b, c.r, c.g, c.b], (i - 1) * 6);
    }
    const position = new Float32BufferAttribute(positions, 3);
    const lines = (material: LineBasicMaterial, withColors: boolean) => {
      // Both share the positions, each with its own draw range.
      const geom = new BufferGeometry();
      geom.setAttribute('position', position);
      if (withColors) geom.setAttribute('color', new Float32BufferAttribute(colors, 3));
      const segments = new LineSegments(geom, material);
      segments.frustumCulled = false;
      segments.renderOrder = 2;
      segments.raycast = () => null;
      return segments;
    };
    return {
      ahead: lines(new LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.45, depthTest: false }), true),
      done: lines(new LineBasicMaterial({ color: kJobDoneColor, transparent: true, opacity: 0.6, depthTest: false }), false),
    };
  }, [toolpath, showRapids]);
  useEffect(
    () => () => {
      for (const lines of [ahead, done]) {
        lines.geometry.dispose();
        (lines.material as LineBasicMaterial).dispose();
      }
    },
    [ahead, done]
  );
  useFrame(() => {
    const { index, fraction } = currentPlayhead(toolpath);
    const count = ahead.geometry.attributes.position.count;
    // The segment under the tool counts as ahead until it is complete.
    const split = Math.min((fraction >= 1 ? index : Math.max(index - 1, 0)) * 2, count);
    ahead.geometry.setDrawRange(split, count - split);
    done.geometry.setDrawRange(0, split);
  });
  return (
    <>
      <primitive object={done} />
      <primitive object={ahead} />
    </>
  );
}

/**
 * The simulated tool at the playhead, placed like the machine's tool marker: in work XY and scene Z (`sceneZ` maps
 * toolpath Z to the scaled, Z0-shifted scene).
 */
export function SimToolMarker({ toolpath, sceneZ, length }: { toolpath: ParsedToolpath; sceneZ: (z: number) => number; length: number }) {
  const group = useRef<Group>(null);
  const toolDiameter = useToolDiameter();
  const toolShape = useDepthView(s => s.toolShape);
  const tools = useMemo(() => parseToolInfo(toolpath.gcode), [toolpath]);
  const position = useMemo(() => new Vector3(), []);
  // Tool number at the playhead; changes rarely, so it is React state.
  const [tool, setTool] = useState(toolpath.modals[1]?.tool);
  useFrame(() => {
    const { index, fraction } = currentPlayhead(toolpath);
    const points = toolpath.pathPoints;
    if (!group.current || points.length === 0) return;
    const b = points[Math.min(index, points.length - 1)];
    const a = points[Math.max(index - 1, 0)];
    position.lerpVectors(a, b, fraction);
    group.current.position.set(position.x, position.y, sceneZ(position.z));
    const current = toolpath.modals[index]?.tool;
    if (current !== tool) setTool(current);
  });
  const shape = resolveToolShape(tool, tools, toolDiameter, toolShape);
  return (
    <group ref={group}>
      <ToolPositionMarker radius={shape.radius} length={length} color="#38bdf8" />
    </group>
  );
}
