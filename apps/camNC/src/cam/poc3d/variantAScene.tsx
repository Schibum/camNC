/** THROWAWAY concept A: the simulated stock surface with an op removal mask, and the toolpath lines of a range. */
import { useEffect, useMemo } from 'react';
import {
  BufferGeometry,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  LineBasicMaterial,
  LineSegments,
  PlaneGeometry,
  ShaderMaterial,
  Texture,
} from 'three';
import type { ParsedToolpath } from '@/visualize/gcodeParsing';
import { isRapidSegment } from '@/visualize/depthInspection';
import type { HeightmapDomain } from '@/visualize/stockSim/HeightmapStamper';
import type { Playhead } from '@/visualize/stockSim/jobTimeline';

const kStock = new Color('#c9a46e');
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
  uniform sampler2D uCurrent;
  uniform sampler2D uBefore;
  uniform sampler2D uAfter;
  uniform vec2 uZRange;
  uniform float uBottom;
  uniform vec3 uColor;
  uniform vec3 uHighlight;
  uniform bool uHasOp;
  varying vec3 vPos;
  varying vec2 vUv;

  float heightOf(sampler2D t) { return mix(uZRange.x, uZRange.y, texture(t, vUv).r); }

  void main() {
    if (vPos.z <= uBottom + 1e-3) discard;
    vec3 n = normalize(cross(dFdx(vPos), dFdy(vPos)));
    if (n.z < 0.0) n = -n;
    float diffuse = 0.4 + 0.6 * max(dot(n, normalize(vec3(-0.4, -0.6, 1.0))), 0.0);
    float top = uZRange.y;
    float depth = clamp((top - vPos.z) / max(top - uBottom, 1e-3), 0.0, 1.0);
    bool uncut = top - vPos.z < 1e-3;
    vec3 color = uncut ? uColor * 1.08 : uColor * (0.92 - depth * 0.35);
    if (uHasOp) {
      float before = heightOf(uBefore);
      float after = heightOf(uAfter);
      if (after < before - 0.02) {
        // This op cuts here. Already cut (at or below where the op ends): solid; still to cut: a faint tint.
        bool cut = vPos.z <= after + 0.02;
        bool started = vPos.z < before - 0.02;
        float k = cut ? 0.85 : started ? 0.6 : 0.35;
        color = mix(color, uHighlight * (cut ? 1.0 : 1.15), k);
      }
    }
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
  uniform sampler2D uCurrent;
  uniform vec2 uZRange;
  uniform float uBottom;
  uniform vec3 uColor;
  varying vec2 vUv;
  void main() {
    if (mix(uZRange.x, uZRange.y, texture(uCurrent, vUv).r) <= uBottom + 1e-3) discard;
    gl_FragColor = vec4(uColor, 1.0);
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
    if (i < segments) index.push(i * 2, i * 2 + 2, i * 2 + 1, i * 2 + 1, i * 2 + 2, i * 2 + 3);
  }
  geom.setAttribute('edge', new Float32BufferAttribute(edge, 2));
  geom.setAttribute('position', new Float32BufferAttribute(new Array((segments + 1) * 6).fill(0), 3));
  geom.setIndex(index);
  return geom;
}

export function StockMesh({
  domain,
  bottom,
  current,
  before,
  after,
  highlight,
}: {
  domain: HeightmapDomain;
  bottom: number;
  current: Texture;
  before: Texture;
  after: Texture;
  highlight: Color | null;
}) {
  const { footprint } = domain;
  const sizeX = footprint.max.x - footprint.min.x;
  const sizeY = footprint.max.y - footprint.min.y;
  const gridX = Math.min(domain.width, kMaxGrid);
  const gridY = Math.min(domain.height, kMaxGrid);
  const plane = useMemo(() => new PlaneGeometry(sizeX, sizeY, gridX, gridY), [sizeX, sizeY, gridX, gridY]);
  const wall = useMemo(() => wallGeometry(Math.max(gridX, gridY)), [gridX, gridY]);
  const materials = useMemo(() => {
    const common = () => ({
      uCurrent: { value: null as Texture | null },
      uZRange: { value: [0, 0] },
      uBottom: { value: 0 },
    });
    const surface = new ShaderMaterial({
      vertexShader: kSurfaceVertex,
      fragmentShader: kSurfaceFragment,
      uniforms: {
        ...common(),
        uBefore: { value: null },
        uAfter: { value: null },
        uColor: { value: kStock.clone() },
        uHighlight: { value: new Color() },
        uHasOp: { value: false },
      },
      side: DoubleSide,
    });
    const bottomFace = new ShaderMaterial({
      vertexShader: kBottomVertex,
      fragmentShader: kBottomFragment,
      uniforms: { ...common(), uColor: { value: kStock.clone().multiplyScalar(0.5) } },
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
            uFootprint: { value: [0, 0, 0, 0] },
            uColor: { value: kStock.clone().multiplyScalar(shade) },
          },
          side: DoubleSide,
        })
    );
    return { surface, bottomFace, walls };
  }, []);
  useEffect(
    () => () => {
      plane.dispose();
      wall.dispose();
    },
    [plane, wall]
  );
  useEffect(() => () => [materials.surface, materials.bottomFace, ...materials.walls].forEach(m => m.dispose()), [materials]);

  useEffect(() => {
    const { surface, bottomFace, walls } = materials;
    for (const m of [surface, bottomFace, ...walls]) {
      m.uniforms.uCurrent.value = current;
      m.uniforms.uZRange.value = [domain.zLow, domain.zTop];
      m.uniforms.uBottom.value = bottom;
    }
    surface.uniforms.uBefore.value = before;
    surface.uniforms.uAfter.value = after;
    surface.uniforms.uHasOp.value = highlight !== null;
    if (highlight) surface.uniforms.uHighlight.value.copy(highlight);
    for (const m of walls) m.uniforms.uFootprint.value = [footprint.min.x, footprint.min.y, sizeX, sizeY];
  }, [materials, current, before, after, highlight, domain, bottom, footprint, sizeX, sizeY]);

  const center: [number, number, number] = [(footprint.min.x + footprint.max.x) / 2, (footprint.min.y + footprint.max.y) / 2, 0];
  return (
    <>
      <mesh geometry={plane} material={materials.surface} position={center} frustumCulled={false} />
      <mesh geometry={plane} material={materials.bottomFace} position={center} frustumCulled={false} />
      {materials.walls.map((m, i) => (
        <mesh key={i} geometry={wall} material={m} frustumCulled={false} />
      ))}
    </>
  );
}

/** Cutting moves of points from..to: done (up to the playhead) dim, ahead bright. Rapids are left out. */
export function OpLines({
  toolpath,
  from,
  to,
  playhead,
  color,
  faint = false,
}: {
  toolpath: ParsedToolpath;
  from: number;
  to: number;
  playhead: Playhead;
  color: string;
  faint?: boolean;
}) {
  const { done, ahead } = useMemo(() => {
    const points = toolpath.pathPoints;
    const n = Math.max(to - from, 0);
    const positions = new Float32Array(n * 6);
    for (let i = from + 1; i <= to; i++) {
      const a = points[i - 1];
      const b = isRapidSegment(toolpath, i) ? a : points[i];
      positions.set([a.x, a.y, a.z, b.x, b.y, b.z], (i - from - 1) * 6);
    }
    const position = new Float32BufferAttribute(positions, 3);
    const make = (c: string, opacity: number) => {
      const geom = new BufferGeometry();
      geom.setAttribute('position', position);
      const lines = new LineSegments(geom, new LineBasicMaterial({ color: c, transparent: true, opacity, depthTest: false }));
      lines.frustumCulled = false;
      lines.renderOrder = 2;
      return lines;
    };
    return { done: make('#4ade80', faint ? 0.25 : 0.45), ahead: make(color, faint ? 0.35 : 0.95) };
  }, [toolpath, from, to, color, faint]);
  useEffect(
    () => () => {
      for (const l of [done, ahead]) {
        l.geometry.dispose();
        (l.material as LineBasicMaterial).dispose();
      }
    },
    [done, ahead]
  );
  useEffect(() => {
    const count = Math.max(to - from, 0) * 2;
    const reached = playhead.fraction >= 1 ? playhead.index : playhead.index - 1;
    const split = Math.min(Math.max((reached - from) * 2, 0), count);
    done.geometry.setDrawRange(0, split);
    ahead.geometry.setDrawRange(split, count - split);
  }, [done, ahead, playhead, from, to]);
  return (
    <>
      <primitive object={done} />
      <primitive object={ahead} />
    </>
  );
}
