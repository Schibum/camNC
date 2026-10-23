import { Edges, Html, Line } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { cn } from '@wbcnc/ui/lib/utils';
import { useEffect, useMemo, useState } from 'react';
import { Color, DoubleSide, FrontSide, MeshBasicMaterial, ShaderMaterial, Vector3 } from 'three';
import { DepthLevel, pickLabelLevels } from './depthInspection';

const kGridVertexShader = /* glsl */ `
  varying vec2 vWorld;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xy;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const kGridFragmentShader = /* glsl */ `
  uniform vec2 uCenter;
  uniform float uRadius;
  uniform float uMinorStep;
  uniform float uMajorStep;
  uniform vec3 uMinorColor;
  uniform vec3 uMajorColor;
  varying vec2 vWorld;

  // Anti-aliased grid line intensity, about one pixel wide at any zoom.
  float gridLine(vec2 p, float step) {
    vec2 coord = p / step;
    vec2 g = abs(fract(coord - 0.5) - 0.5) / fwidth(coord);
    return 1.0 - min(min(g.x, g.y), 1.0);
  }

  void main() {
    float minor = gridLine(vWorld, uMinorStep);
    float major = gridLine(vWorld, uMajorStep);
    float fade = 1.0 - smoothstep(uRadius * 0.3, uRadius, distance(vWorld, uCenter));
    float alpha = max(minor * 0.45, major * 0.9) * fade;
    if (alpha < 0.01) discard;
    gl_FragColor = vec4(mix(uMinorColor, uMajorColor, major), alpha);
    #include <colorspace_fragment>
  }
`;

/**
 * Machine bed below the stock: a grid in machine coordinates that fades out around the stock, so the part sits on
 * something without the grid competing with the toolpath.
 */
export function BedGrid({ center, radius, z }: { center: Vector3; radius: number; z: number }) {
  // Grid steps in mm, coarser for large parts so lines stay a few pixels apart.
  const minorStep = radius > 600 ? 50 : radius > 150 ? 10 : 5;
  const material = useMemo(
    () =>
      new ShaderMaterial({
        vertexShader: kGridVertexShader,
        fragmentShader: kGridFragmentShader,
        transparent: true,
        depthWrite: false,
        side: FrontSide,
        uniforms: {
          uCenter: { value: [0, 0] },
          uRadius: { value: 1 },
          uMinorStep: { value: 10 },
          uMajorStep: { value: 50 },
          uMinorColor: { value: new Color('#334155') },
          uMajorColor: { value: new Color('#64748b') },
        },
      }),
    []
  );
  useEffect(() => () => material.dispose(), [material]);
  useEffect(() => {
    material.uniforms.uCenter.value = [center.x, center.y];
    material.uniforms.uRadius.value = radius;
    material.uniforms.uMinorStep.value = minorStep;
    material.uniforms.uMajorStep.value = minorStep * 5;
  }, [material, center, radius, minorStep]);

  return (
    <mesh position={[center.x, center.y, z]} material={material} renderOrder={-3} raycast={() => null}>
      <planeGeometry args={[radius * 2, radius * 2]} />
    </mesh>
  );
}

// Stock faces are tinted per direction to fake lighting, so the block reads as a solid without a lighting setup.
const kStockColor = '#c9a46e';
const kStockFaceOpacity = {
  // Order of BoxGeometry groups: +X, -X, +Y, -Y, +Z, -Z.
  side: [0.2, 0.32, 0.26, 0.38],
  top: 0.1,
};

/**
 * Translucent stock block, `height` mm deep below Z 0 (the stock top). The top face is left out while the camera
 * image covers it.
 */
export function StockBlock({
  center,
  size,
  height,
  showTop,
}: {
  center: Vector3;
  size: [number, number];
  height: number;
  showTop: boolean;
}) {
  const materials = useMemo(() => {
    const shade = (lightness: number, opacity: number) =>
      new MeshBasicMaterial({
        color: new Color(kStockColor).offsetHSL(0, 0, lightness),
        transparent: true,
        opacity,
        depthWrite: false,
        side: DoubleSide,
        // The top face is coplanar with the video, push the block behind to avoid z-fighting.
        polygonOffset: true,
        polygonOffsetFactor: 2,
        polygonOffsetUnits: 8,
      });
    const [px, nx, py, ny] = kStockFaceOpacity.side;
    return [shade(0.08, px), shade(-0.04, nx), shade(0.02, py), shade(-0.1, ny), shade(0.12, kStockFaceOpacity.top), shade(-0.2, 0.25)];
  }, []);
  useEffect(() => () => materials.forEach(m => m.dispose()), [materials]);
  useEffect(() => {
    materials[4].visible = showTop;
  }, [materials, showTop]);
  return (
    <mesh position={[center.x, center.y, -height / 2]} material={materials} raycast={() => null} renderOrder={-1}>
      <boxGeometry args={[size[0], size[1], height]} />
      <Edges color="#e9c891" transparent opacity={0.8} renderOrder={0} />
    </mesh>
  );
}

function formatMm(value: number) {
  return value.toFixed(2);
}

const tmpDirection = new Vector3();

/**
 * Depth ruler on the front corner of the stock: a vertical line from the stock top down to the deepest cut, with a
 * tick and a label for each cut level.
 */
export function DepthRuler({
  levels,
  x,
  y,
  zScale,
  shift,
  selected,
}: {
  levels: DepthLevel[];
  x: number;
  y: number;
  zScale: number;
  // Toolpath Z to Z relative to the stock top.
  shift: number;
  selected: number | null;
}) {
  const [labelZs, setLabelZs] = useState<number[]>([]);
  const sceneZ = (z: number) => (z + shift) * zScale;
  const deepest = levels.length ? sceneZ(levels[0].z) : 0;
  const top = Math.max(0, levels.length ? sceneZ(levels[levels.length - 1].z) : 0);
  const tick = Math.max(Math.abs(deepest - top), 1) * 0.04 + 1;

  useFrame(({ camera }) => {
    // Screen pixels per mm of toolpath Z: the orthographic zoom, shortened by the camera tilt.
    camera.getWorldDirection(tmpDirection);
    const pxPerMm = camera.zoom * zScale * Math.sqrt(Math.max(0, 1 - tmpDirection.z ** 2));
    const next = pickLabelLevels(levels, pxPerMm, selected);
    setLabelZs(prev => (prev.length === next.length && prev.every((z, i) => z === next[i]) ? prev : next));
  });

  const ticks = useMemo(
    () =>
      levels.flatMap(level => {
        const z = (level.z + shift) * zScale;
        return [new Vector3(x, y, z), new Vector3(x - tick, y - tick, z)];
      }),
    [levels, shift, zScale, x, y, tick]
  );

  if (levels.length === 0) return null;
  return (
    <group>
      <Line
        points={[
          [x, y, top],
          [x, y, deepest],
        ]}
        color="#94a3b8"
        lineWidth={1}
        depthTest={false}
        transparent
        renderOrder={3}
      />
      <Line segments points={ticks} color="#94a3b8" lineWidth={1} depthTest={false} transparent renderOrder={3} />
      {labelZs.map(z => (
        <Html key={z} position={[x - tick, y - tick, sceneZ(z)]} center={false} style={{ pointerEvents: 'none' }} zIndexRange={[10, 0]}>
          <div
            className={cn(
              '-translate-x-full -translate-y-1/2 whitespace-nowrap rounded px-1 font-mono text-[10px] leading-4 ring-1',
              z === selected ? 'bg-sky-500/90 text-white ring-sky-300/60' : 'bg-slate-900/75 text-slate-200 ring-white/10'
            )}>
            {formatMm(z)}
          </div>
        </Html>
      ))}
    </group>
  );
}

/** Outlined plane at the selected cut level. */
export function LevelPlane({ center, size, z }: { center: Vector3; size: [number, number]; z: number }) {
  return (
    <mesh position={[center.x, center.y, z]} renderOrder={3} raycast={() => null}>
      <planeGeometry args={size} />
      <meshBasicMaterial color="#38bdf8" transparent opacity={0.12} depthWrite={false} depthTest={false} side={2} />
      <Edges color="#7dd3fc" depthTest={false} transparent opacity={0.9} renderOrder={3} />
    </mesh>
  );
}

/** Screen-space ring around the hovered toolpath point, with a dashed drop line to the stock top. */
export function HoverMarker({ position, topZ, dashSize }: { position: Vector3; topZ: number; dashSize: number }) {
  return (
    <>
      <Html position={position} center style={{ pointerEvents: 'none' }} zIndexRange={[10, 0]}>
        <div className="size-3.5 rounded-full border-2 border-white bg-sky-400/40 shadow-[0_0_0_3px_rgba(0,0,0,0.45)]" />
      </Html>
      <Line
        points={[
          [position.x, position.y, topZ],
          [position.x, position.y, position.z],
        ]}
        color="white"
        lineWidth={1}
        dashed
        depthTest={false}
        transparent
        opacity={0.8}
        renderOrder={3}
        dashSize={dashSize}
        gapSize={dashSize * 0.6}
      />
    </>
  );
}

/** Small axis label next to the end of an axis line. */
export function AxisLabel({ position, label, className }: { position: [number, number, number]; label: string; className: string }) {
  return (
    <Html position={position} center style={{ pointerEvents: 'none' }} zIndexRange={[10, 0]}>
      <span className={cn('font-mono text-[10px] font-bold drop-shadow-[0_1px_1px_rgba(0,0,0,0.9)]', className)}>{label}</span>
    </Html>
  );
}
