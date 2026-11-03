import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import {
  Box2,
  BufferGeometry,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  LineBasicMaterial,
  LineSegments,
  PlaneGeometry,
  ShaderMaterial,
  Texture,
  Vector2,
} from 'three';
import type { ParsedToolpath } from '@/visualize/gcodeParsing';
import { HeightmapStamper, heightmapSize, type HeightmapDomain } from '@/visualize/stockSim/HeightmapStamper';
import type { Playhead } from '@/visualize/stockSim/jobTimeline';
import type { ToolShape } from '@/visualize/stockSim/toolShapes';
import { cutsOf, onlyOps, type PlanOp } from './planModel';
import { kStockColor } from './palette';

const kMaxHeightmap = 2048;
const kMaxGrid = 768;

const kSurfaceVertex = /* glsl */ `
  uniform sampler2D uCurrent;
  uniform vec2 uZRange;
  varying vec3 vPos;
  varying vec2 vUv;
  void main() {
    vUv = uv;
    float z = mix(uZRange.x, uZRange.y, texture(uCurrent, uv).r);
    vPos = vec3(position.xy, z);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(vPos, 1.0);
  }
`;

const kSurfaceFragment = /* glsl */ `
  uniform sampler2D uMask;
  uniform vec2 uZRange;
  uniform float uBottom;
  uniform vec3 uColor;
  uniform vec3 uHighlight;
  uniform bool uHasOp;
  uniform float uOpacity;
  varying vec3 vPos;
  varying vec2 vUv;

  void main() {
    if (vPos.z <= uBottom + 1e-3) discard;
    vec3 n = normalize(cross(dFdx(vPos), dFdy(vPos)));
    if (n.z < 0.0) n = -n;
    float diffuse = 0.45 + 0.55 * max(dot(n, normalize(vec3(-0.4, -0.6, 1.0))), 0.0);
    float top = uZRange.y;
    float depth = clamp((top - vPos.z) / max(top - uBottom, 1e-3), 0.0, 1.0);
    bool uncut = top - vPos.z < 1e-3;
    vec3 color = uncut ? uColor * 1.08 : uColor * (0.92 - depth * 0.35);
    if (uHasOp) {
      // uMask: the stock after only the selected op. Where it cuts: solid once cut that deep, a tint until then.
      float op = mix(uZRange.x, uZRange.y, texture(uMask, vUv).r);
      if (op < top - 0.02) color = mix(color, uHighlight, vPos.z <= op + 0.02 ? 0.9 : 0.35);
    }
    gl_FragColor = vec4(color * diffuse, uOpacity);
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
  uniform sampler2D uCurrent;
  uniform vec2 uZRange;
  uniform float uBottom;
  uniform vec3 uColor;
  uniform float uOpacity;
  varying vec2 vUv;
  void main() {
    if (mix(uZRange.x, uZRange.y, texture(uCurrent, vUv).r) <= uBottom + 1e-3) discard;
    gl_FragColor = vec4(uColor, uOpacity);
    #include <colorspace_fragment>
  }
`;

const kWallVertex = /* glsl */ `
  uniform sampler2D uCurrent;
  uniform vec2 uZRange;
  uniform float uBottom;
  uniform vec2 uFrom;
  uniform vec2 uTo;
  uniform vec4 uFootprint;
  attribute vec2 edge;
  varying float vTop;
  void main() {
    vec2 uv = mix(uFrom, uTo, edge.x);
    float top = mix(uZRange.x, uZRange.y, texture(uCurrent, uv).r);
    vTop = top;
    vec2 xy = uFootprint.xy + uv * uFootprint.zw;
    float z = edge.y > 0.5 ? max(top, uBottom) : uBottom;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(xy, z, 1.0);
  }
`;

const kWallFragment = /* glsl */ `
  uniform float uBottom;
  uniform vec3 uColor;
  uniform float uOpacity;
  varying float vTop;
  void main() {
    if (vTop <= uBottom + 1e-3) discard;
    gl_FragColor = vec4(uColor, uOpacity);
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
    if (i < segments) index.push(i * 2, i * 2 + 2, i * 2 + 1, i * 2 + 1, i * 2 + 2, i * 2 + 3);
  }
  geom.setAttribute('edge', new Float32BufferAttribute(edge, 2));
  geom.setAttribute('position', new Float32BufferAttribute(new Array((segments + 1) * 6).fill(0), 3));
  geom.setIndex(index);
  return geom;
}

/**
 * The board as the simulation has cut it up to `playhead`, from a GPU heightmap. With ops selected, what they remove
 * is colored. `opacity` < 1 makes the stock see-through.
 */
export function SimStock({
  toolpath,
  size,
  toolShape,
  playhead,
  selected,
  highlight,
  opacity,
}: {
  toolpath: ParsedToolpath;
  size: [number, number, number];
  toolShape: (tool: number | undefined) => ToolShape;
  playhead: Playhead;
  /** The ops whose removal is colored; empty for none. */
  selected: PlanOp[];
  highlight: string;
  opacity: number;
}) {
  const gl = useThree(s => s.gl);
  const [w, h, zTop] = size;
  const domain = useMemo<HeightmapDomain>(() => {
    const pad = Math.max(1, toolShape(undefined).radius) * 2;
    const footprint = new Box2(new Vector2(-pad, -pad), new Vector2(w + pad, h + pad));
    const zLow = Math.min(0, toolpath.getBounds().min.z) - 1;
    const px = heightmapSize(footprint, Math.min(kMaxHeightmap, gl.capabilities.maxTextureSize));
    return { footprint, zTop, zLow, width: px.width, height: px.height };
  }, [w, h, zTop, toolpath, gl, toolShape]);
  const stamper = useMemo(() => new HeightmapStamper(toolpath, domain, toolShape), [toolpath, domain, toolShape]);
  // The stock after only the selected ops, from fresh stock: where they cut and how deep.
  const mask = useMemo(
    () => (selected.length ? new HeightmapStamper(onlyOps(toolpath, selected), domain, toolShape) : null),
    [toolpath, domain, toolShape, selected]
  );
  useEffect(() => () => stamper.dispose(), [stamper]);
  useEffect(() => () => mask?.dispose(), [mask]);
  useFrame(() => {
    stamper.update(gl, playhead);
    mask?.update(gl, { index: toolpath.pathPoints.length - 1, fraction: 1 });
  });

  return (
    <StockMesh domain={domain} current={stamper.depthTexture} mask={mask?.depthTexture ?? null} highlight={highlight} opacity={opacity} />
  );
}

function StockMesh({
  domain,
  current,
  mask,
  highlight,
  opacity,
}: {
  domain: HeightmapDomain;
  current: Texture;
  mask: Texture | null;
  highlight: string;
  opacity: number;
}) {
  const { footprint } = domain;
  const sizeX = footprint.max.x - footprint.min.x;
  const sizeY = footprint.max.y - footprint.min.y;
  const gridX = Math.min(domain.width, kMaxGrid);
  const gridY = Math.min(domain.height, kMaxGrid);
  const plane = useMemo(() => new PlaneGeometry(sizeX, sizeY, gridX, gridY), [sizeX, sizeY, gridX, gridY]);
  const wall = useMemo(() => wallGeometry(Math.max(gridX, gridY)), [gridX, gridY]);
  const materials = useMemo(() => {
    const stock = new Color(kStockColor);
    const common = () => ({
      uCurrent: { value: null as Texture | null },
      uZRange: { value: new Vector2() },
      uBottom: { value: 0 },
      uOpacity: { value: 1 },
    });
    const surface = new ShaderMaterial({
      vertexShader: kSurfaceVertex,
      fragmentShader: kSurfaceFragment,
      uniforms: {
        ...common(),
        uMask: { value: null },
        uColor: { value: stock.clone() },
        uHighlight: { value: new Color() },
        uHasOp: { value: false },
      },
      side: DoubleSide,
      // Toolpath lines lie right on the cut floors: push the surface back a little so they win the depth test.
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    });
    const bottomFace = new ShaderMaterial({
      vertexShader: kBottomVertex,
      fragmentShader: kBottomFragment,
      uniforms: { ...common(), uColor: { value: stock.clone().multiplyScalar(0.5) } },
      side: DoubleSide,
    });
    const walls = kWalls.map(
      ({ from, to, shade }) =>
        new ShaderMaterial({
          vertexShader: kWallVertex,
          fragmentShader: kWallFragment,
          uniforms: {
            ...common(),
            uFrom: { value: new Vector2(...from) },
            uTo: { value: new Vector2(...to) },
            uFootprint: { value: [0, 0, 0, 0] },
            uColor: { value: stock.clone().multiplyScalar(shade) },
          },
          side: DoubleSide,
        })
    );
    return { surface, bottomFace, walls, all: [surface, bottomFace, ...walls] };
  }, []);
  useEffect(
    () => () => {
      plane.dispose();
      wall.dispose();
    },
    [plane, wall]
  );
  useEffect(() => () => materials.all.forEach(m => m.dispose()), [materials]);

  useEffect(() => {
    const { surface, walls, all } = materials;
    const seeThrough = opacity < 1;
    for (const m of all) {
      m.uniforms.uCurrent.value = current;
      m.uniforms.uZRange.value.set(domain.zLow, domain.zTop);
      m.uniforms.uBottom.value = 0;
      m.uniforms.uOpacity.value = opacity;
      if (m.transparent !== seeThrough) {
        m.transparent = seeThrough;
        m.depthWrite = !seeThrough;
        m.needsUpdate = true;
      }
    }
    surface.uniforms.uMask.value = mask;
    surface.uniforms.uHasOp.value = mask !== null;
    surface.uniforms.uHighlight.value.set(highlight);
    for (const m of walls) m.uniforms.uFootprint.value = [footprint.min.x, footprint.min.y, sizeX, sizeY];
  }, [materials, current, mask, highlight, opacity, domain, footprint, sizeX, sizeY]);

  const center: [number, number, number] = [(footprint.min.x + footprint.max.x) / 2, (footprint.min.y + footprint.max.y) / 2, 0];
  return (
    <>
      <mesh geometry={plane} material={materials.surface} position={center} frustumCulled={false} renderOrder={1} />
      <mesh geometry={plane} material={materials.bottomFace} position={center} frustumCulled={false} renderOrder={1} />
      {materials.walls.map((m, i) => (
        <mesh key={i} geometry={wall} material={m} frustumCulled={false} renderOrder={1} />
      ))}
    </>
  );
}

/**
 * Cutting moves of `ops`, split at the playhead: the part already cut dim (`doneOpacity`), the part still ahead in `color`. Thin
 * lines; rapids are left out. `onTop` draws them through the stock.
 */
export function SimLines({
  toolpath,
  ops,
  playhead,
  color,
  opacity,
  doneOpacity = opacity * 0.35,
  onTop,
}: {
  toolpath: ParsedToolpath;
  ops: PlanOp[];
  playhead: Playhead;
  color: string;
  opacity: number;
  doneOpacity?: number;
  onTop: boolean;
}) {
  // Moves in path order, with the path index each one ends at, to split at the playhead.
  const { lines, ends } = useMemo(() => {
    const points = toolpath.pathPoints;
    const cuts = cutsOf(toolpath, ops);
    const pos: number[] = [];
    const ends: number[] = [];
    for (const o of [...ops].sort((a, b) => a.from - b.from))
      for (let i = o.from; i <= o.to; i++) {
        if (!cuts(i)) continue;
        const [a, b] = [points[i - 1], points[i]];
        pos.push(a.x, a.y, a.z, b.x, b.y, b.z);
        ends.push(i);
      }
    const geom = new BufferGeometry();
    geom.setAttribute('position', new Float32BufferAttribute(pos, 3));
    const make = () => {
      const l = new LineSegments(geom.clone(), new LineBasicMaterial({ transparent: true }));
      l.frustumCulled = false;
      l.renderOrder = 3;
      return l;
    };
    geom.dispose();
    return { lines: { done: make(), ahead: make() }, ends };
  }, [toolpath, ops]);
  useEffect(
    () => () => {
      for (const l of [lines.done, lines.ahead]) {
        l.geometry.dispose();
        (l.material as LineBasicMaterial).dispose();
      }
    },
    [lines]
  );
  useEffect(() => {
    const reached = playhead.fraction >= 1 ? playhead.index : playhead.index - 1;
    let split = 0;
    while (split < ends.length && ends[split] <= reached) split++;
    lines.done.geometry.setDrawRange(0, split * 2);
    lines.ahead.geometry.setDrawRange(split * 2, (ends.length - split) * 2);
    const style = (l: LineSegments, c: string, o: number) => {
      const m = l.material as LineBasicMaterial;
      m.color.set(c);
      m.opacity = o;
      m.depthTest = !onTop;
    };
    style(lines.done, color, doneOpacity);
    style(lines.ahead, color, opacity);
  }, [lines, ends, playhead, color, opacity, doneOpacity, onTop]);
  return (
    <>
      <primitive object={lines.done} />
      <primitive object={lines.ahead} />
    </>
  );
}
