/** THROWAWAY concept C: stock after an op, with the material that op removed highlighted. */
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import {
  Box2,
  BufferGeometry,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  LineBasicMaterial,
  LineSegments,
  PerspectiveCamera,
  PlaneGeometry,
  SRGBColorSpace,
  ShaderMaterial,
  Vector2,
  WebGLRenderTarget,
} from 'three';
import { isRapidSegment } from '@/visualize/depthInspection';
import type { ParsedToolpath } from '@/visualize/gcodeParsing';
import { parseToolInfo } from '@/visualize/guess-tools';
import { HeightmapStamper, heightmapSize } from '@/visualize/stockSim/HeightmapStamper';
import type { Playhead } from '@/visualize/stockSim/jobTimeline';
import { resolveToolShape } from '@/visualize/stockSim/toolShapes';
import { kDefaultBit } from '../planSettings';
import type { PocBoard } from './usePocBoard';
import { type OpGroup, viewFor } from './variantCUtil';

const kStockColor = new Color('#c9a46e');
const kRemovedColor = new Color('#f97316');
const kBackground = new Color('#161b24');
const kMaxHeightmapSize = 2048;
const kMaxGridSize = 640;

/** Playheads before and after a group (`null`: the finished job, nothing highlighted). */
function playheads(toolpath: ParsedToolpath, group: OpGroup | null): [Playhead, Playhead] {
  const end = { index: toolpath.pathPoints.length - 1, fraction: 1 };
  if (!group) return [end, end];
  return [
    { index: Math.max(group.from, 0), fraction: 1 },
    { index: group.to, fraction: 1 },
  ];
}

const kSurfaceVertex = /* glsl */ `
  uniform sampler2D uAfter;
  uniform sampler2D uBefore;
  uniform vec2 uZRange;
  uniform bool uGhost;
  varying vec3 vPos;
  varying float vRemoved;
  void main() {
    float after = mix(uZRange.x, uZRange.y, texture(uAfter, uv).r);
    float before = mix(uZRange.x, uZRange.y, texture(uBefore, uv).r);
    vRemoved = before - after > 0.02 ? 1.0 : 0.0;
    vPos = vec3(position.xy, uGhost ? before : after);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(vPos, 1.0);
  }
`;

const kSurfaceFragment = /* glsl */ `
  uniform vec2 uZRange;
  uniform float uBottom;
  uniform vec3 uColor;
  uniform vec3 uRemoved;
  uniform bool uGhost;
  varying vec3 vPos;
  varying float vRemoved;
  void main() {
    if (uGhost) {
      // Ghost of the removed material at its old height.
      if (vRemoved < 0.5) discard;
      gl_FragColor = vec4(uRemoved, 0.28);
      #include <colorspace_fragment>
      return;
    }
    if (vPos.z <= uBottom + 1e-3) discard;
    vec3 n = normalize(cross(dFdx(vPos), dFdy(vPos)));
    if (n.z < 0.0) n = -n;
    vec3 light = normalize(vec3(-0.4, -0.6, 1.0));
    float diffuse = 0.45 + 0.55 * max(dot(n, light), 0.0);
    float top = uZRange.y;
    float depth = clamp((top - vPos.z) / max(top - uBottom, 1e-3), 0.0, 1.0);
    bool uncut = top - vPos.z < 1e-3;
    vec3 color = uncut ? uColor * 1.08 : uColor * (0.92 - depth * 0.35);
    color = mix(color, uRemoved, smoothstep(0.0, 1.0, vRemoved) * 0.85);
    gl_FragColor = vec4(color * diffuse, 1.0);
    #include <colorspace_fragment>
  }
`;

const kBottomVertex = /* glsl */ `
  uniform float uBottom;
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position.xy, uBottom, 1.0);
  }
`;

const kBottomFragment = /* glsl */ `
  uniform sampler2D uAfter;
  uniform vec2 uZRange;
  uniform float uBottom;
  uniform vec3 uColor;
  varying vec2 vUv;
  void main() {
    if (mix(uZRange.x, uZRange.y, texture(uAfter, vUv).r) <= uBottom + 1e-3) discard;
    gl_FragColor = vec4(uColor, 1.0);
    #include <colorspace_fragment>
  }
`;

const kWallVertex = /* glsl */ `
  uniform sampler2D uAfter;
  uniform vec2 uZRange;
  uniform float uBottom;
  uniform vec2 uFrom;
  uniform vec2 uTo;
  uniform vec4 uFootprint;
  attribute vec2 edge;
  varying float vTop;
  void main() {
    vec2 uv = mix(uFrom, uTo, edge.x);
    float top = mix(uZRange.x, uZRange.y, texture(uAfter, uv).r);
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

const kWalls: { from: [number, number]; to: [number, number]; shade: number }[] = [
  { from: [0, 0], to: [1, 0], shade: 0.78 },
  { from: [1, 0], to: [1, 1], shade: 0.66 },
  { from: [1, 1], to: [0, 1], shade: 0.55 },
  { from: [0, 1], to: [0, 0], shade: 0.7 },
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
  geom.setAttribute('position', new Float32BufferAttribute(new Array((segments + 1) * 2 * 3).fill(0), 3));
  geom.setIndex(index);
  return geom;
}

export interface StockSceneProps {
  board: PocBoard;
  groups: OpGroup[];
  selected: number | null;
  showLines: boolean;
  onThumbnails: (urls: string[]) => void;
}

/** Simulated stock between two playheads, plus one-time thumbnail rendering of every op group. */
export function StockScene({ board, groups, selected, showLines, onThumbnails }: StockSceneProps) {
  const gl = useThree(s => s.gl);
  const scene = useThree(s => s.scene);
  const { toolpath, size } = board;
  const [w, h, zTop] = size;
  const bottom = 0;
  const zLow = Math.min(bottom, toolpath.getBounds().min.z) - 1;
  const footprint = useMemo(() => new Box2(new Vector2(-4, -4), new Vector2(w + 4, h + 4)), [w, h]);
  const sizeX = footprint.max.x - footprint.min.x;
  const sizeY = footprint.max.y - footprint.min.y;

  const [before, after] = useMemo(() => {
    const tools = parseToolInfo(toolpath.gcode);
    const s = heightmapSize(footprint, Math.min(kMaxHeightmapSize, gl.capabilities.maxTextureSize));
    const domain = { footprint, zTop, zLow, width: s.width, height: s.height };
    const shape = (tool: number | undefined) => resolveToolShape(tool, tools, kDefaultBit.diameter, 'auto');
    return [new HeightmapStamper(toolpath, domain, shape), new HeightmapStamper(toolpath, domain, shape)];
  }, [toolpath, footprint, zTop, zLow, gl]);
  useEffect(
    () => () => {
      before.dispose();
      after.dispose();
    },
    [before, after]
  );

  const gridX = Math.min(before.domain.width, kMaxGridSize);
  const gridY = Math.min(before.domain.height, kMaxGridSize);
  const surfaceGeometry = useMemo(() => new PlaneGeometry(sizeX, sizeY, gridX, gridY), [sizeX, sizeY, gridX, gridY]);
  const wall = useMemo(() => wallGeometry(Math.max(gridX, gridY)), [gridX, gridY]);

  const materials = useMemo(() => {
    const common = () => ({
      uAfter: { value: after.depthTexture },
      uBefore: { value: before.depthTexture },
      uZRange: { value: [zLow, zTop] },
      uBottom: { value: bottom },
    });
    const surface = new ShaderMaterial({
      vertexShader: kSurfaceVertex,
      fragmentShader: kSurfaceFragment,
      uniforms: { ...common(), uColor: { value: kStockColor }, uRemoved: { value: kRemovedColor }, uGhost: { value: false } },
      side: DoubleSide,
    });
    const ghost = new ShaderMaterial({
      vertexShader: kSurfaceVertex,
      fragmentShader: kSurfaceFragment,
      uniforms: { ...common(), uColor: { value: kStockColor }, uRemoved: { value: kRemovedColor }, uGhost: { value: true } },
      side: DoubleSide,
      transparent: true,
      depthWrite: false,
    });
    const bottomFace = new ShaderMaterial({
      vertexShader: kBottomVertex,
      fragmentShader: kBottomFragment,
      uniforms: { ...common(), uColor: { value: kStockColor.clone().multiplyScalar(0.5) } },
      side: DoubleSide,
    });
    const walls = kWalls.map(
      ({ from, to, shade }) =>
        new ShaderMaterial({
          vertexShader: kWallVertex,
          fragmentShader: kWallFragment,
          uniforms: {
            ...common(),
            uFrom: { value: from },
            uTo: { value: to },
            uFootprint: { value: [footprint.min.x, footprint.min.y, sizeX, sizeY] },
            uColor: { value: kStockColor.clone().multiplyScalar(shade) },
          },
          side: DoubleSide,
        })
    );
    return { surface, ghost, bottomFace, walls };
  }, [before, after, zLow, zTop, footprint, sizeX, sizeY]);
  useEffect(
    () => () => {
      surfaceGeometry.dispose();
      wall.dispose();
      [materials.surface, materials.ghost, materials.bottomFace, ...materials.walls].forEach(m => m.dispose());
    },
    [surfaceGeometry, wall, materials]
  );

  // Toolpath lines of the selected group (cutting moves only).
  const lines = useMemo(() => {
    const group = selected === null ? null : groups[selected];
    if (!group) return null;
    const pts = toolpath.pathPoints;
    const pos: number[] = [];
    for (let i = Math.max(group.from, 1); i <= group.to; i++) {
      if (isRapidSegment(toolpath, i)) continue;
      const a = pts[i - 1];
      const b = pts[i];
      pos.push(a.x, a.y, a.z, b.x, b.y, b.z);
    }
    const geom = new BufferGeometry();
    geom.setAttribute('position', new Float32BufferAttribute(pos, 3));
    const seg = new LineSegments(geom, new LineBasicMaterial({ color: '#7dd3fc', transparent: true, opacity: 0.7, depthTest: false }));
    seg.renderOrder = 3;
    seg.frustumCulled = false;
    return seg;
  }, [selected, groups, toolpath]);
  useEffect(
    () => () => {
      lines?.geometry.dispose();
      (lines?.material as LineBasicMaterial | undefined)?.dispose();
    },
    [lines]
  );

  // Thumbnails: rendered once into images, stepping both heightmaps forward through the groups.
  const thumbsDone = useRef(false);
  const onThumbsRef = useRef(onThumbnails);
  onThumbsRef.current = onThumbnails;
  useFrame(() => {
    if (!thumbsDone.current) {
      thumbsDone.current = true;
      onThumbsRef.current(renderThumbnails());
    }
    const [a, b] = playheads(toolpath, selected === null ? null : (groups[selected] ?? null));
    before.update(gl, a);
    after.update(gl, b);
  });

  function renderThumbnails() {
    const tw = 480;
    const th = 300;
    const rt = new WebGLRenderTarget(tw, th, { samples: 4 });
    rt.texture.colorSpace = SRGBColorSpace;
    const fov = 30;
    const cam = new PerspectiveCamera(fov, tw / th, 1, 10000);
    cam.up.set(0, 0, 1);
    const v = viewFor(board, tw / th, fov);
    cam.position.copy(v.position);
    cam.lookAt(v.center);
    cam.updateMatrixWorld();
    const pixels = new Uint8Array(tw * th * 4);
    const canvas = document.createElement('canvas');
    canvas.width = tw;
    canvas.height = th;
    const ctx = canvas.getContext('2d')!;
    const prevClear = gl.getClearColor(new Color());
    const prevAlpha = gl.getClearAlpha();
    gl.setClearColor(kBackground, 1);
    const prevTarget = gl.getRenderTarget();
    const urls: string[] = [];
    const linesVisible = lines?.visible;
    if (lines) lines.visible = false;
    // The last one is the finished part, without highlight.
    for (const group of [...groups, null]) {
      const [a, b] = playheads(toolpath, group);
      before.update(gl, a);
      after.update(gl, b);
      gl.setRenderTarget(rt);
      gl.clear();
      gl.render(scene, cam);
      gl.readRenderTargetPixels(rt, 0, 0, tw, th, pixels);
      const img = ctx.createImageData(tw, th);
      for (let y = 0; y < th; y++) img.data.set(pixels.subarray((th - 1 - y) * tw * 4, (th - y) * tw * 4), y * tw * 4);
      ctx.putImageData(img, 0, 0);
      urls.push(canvas.toDataURL('image/png'));
    }
    if (lines) lines.visible = linesVisible ?? true;
    gl.setRenderTarget(prevTarget);
    gl.setClearColor(prevClear, prevAlpha);
    rt.dispose();
    return urls;
  }

  const center: [number, number, number] = [(footprint.min.x + footprint.max.x) / 2, (footprint.min.y + footprint.max.y) / 2, 0];
  return (
    <>
      <mesh geometry={surfaceGeometry} material={materials.surface} position={center} frustumCulled={false} />
      <mesh geometry={surfaceGeometry} material={materials.bottomFace} position={center} frustumCulled={false} />
      <mesh geometry={surfaceGeometry} material={materials.ghost} position={center} frustumCulled={false} renderOrder={2} />
      {materials.walls.map((m, i) => (
        <mesh key={i} geometry={wall} material={m} frustumCulled={false} />
      ))}
      {lines && showLines && <primitive object={lines} />}
    </>
  );
}
