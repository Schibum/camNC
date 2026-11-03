import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import {
  BufferAttribute,
  BufferGeometry,
  Float32BufferAttribute,
  InstancedBufferGeometry,
  Matrix4,
  type Mesh,
  type ShaderMaterial,
} from 'three';

/** Largest display grid side (cells): about one vertex per heightmap texel on big boards. */
export const kMaxGridSize = 2048;
/** Grid side while the view moves (playing, orbiting, zooming): light enough for weak GPUs. */
const kMovingGridSize = 768;
/** The view counts as still this long after the last change, ms: then the full grid. */
const kSettleMs = 200;

/** Grid cells per side for a heightmap of this size: one per texel, up to `kMaxGridSize`. */
export const gridCells = (heightmap: { width: number; height: number }) => ({
  x: Math.min(heightmap.width, kMaxGridSize),
  y: Math.min(heightmap.height, kMaxGridSize),
});

/**
 * The stock surface's mesh: `cells.y` instanced rows of `cells.x` quads. It holds only one row's indices (vertex
 * 2i is the lower, 2i + 1 the upper corner of column i): the vertex shader places every vertex from gl_VertexID and
 * gl_InstanceID (`kGridVertex`), so a 2048 × 2048 grid needs no position, normal or uv buffers.
 */
export function gridGeometry(cells: { x: number; y: number }): InstancedBufferGeometry {
  const geom = new InstancedBufferGeometry();
  const index = new Uint16Array(cells.x * 6);
  for (let i = 0; i < cells.x; i++) {
    const [a, b, c, d] = [i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 3];
    index.set([a, c, b, b, c, d], i * 6);
  }
  geom.setIndex(new BufferAttribute(index, 1));
  geom.instanceCount = cells.y;
  return geom;
}

/** GLSL: `gridUv()`, the 0..1 position of this vertex of `gridGeometry` on the heightmap. */
export const kGridVertex = /* glsl */ `
  uniform vec2 uCells;
  vec2 gridUv() {
    return vec2(float(gl_VertexID / 2) / uCells.x, float(gl_InstanceID + gl_VertexID % 2) / uCells.y);
  }
`;

/** A wall along one stock edge, `segments` quads long: x along the edge 0..1, y 0 at the bottom, 1 at the top. */
export function wallGeometry(segments: number) {
  const geom = new BufferGeometry();
  const edge: number[] = [];
  const index: number[] = [];
  for (let i = 0; i <= segments; i++) {
    edge.push(i / segments, 0, i / segments, 1);
    if (i < segments) index.push(i * 2, i * 2 + 2, i * 2 + 1, i * 2 + 1, i * 2 + 2, i * 2 + 3);
  }
  geom.setAttribute('edge', new Float32BufferAttribute(edge, 2));
  // Bounds only, positions come from the heightmap.
  geom.setAttribute('position', new Float32BufferAttribute(new Array((segments + 1) * 6).fill(0), 3));
  geom.setIndex(index);
  return geom;
}

/**
 * The surface grid for a heightmap, adaptive: the full grid (`gridCells`) once the view has been still for
 * `kSettleMs`, a coarser one while the camera moves or `moving()` says the picture changes (the timeline playing).
 * Put `ref` and `geometry` on the mesh; its material gets `uCells` set to match.
 */
export function useAdaptiveGrid(heightmap: { width: number; height: number }, moving: () => boolean) {
  const { width, height } = heightmap;
  const full = useMemo(() => gridCells({ width, height }), [width, height]);
  const coarse = useMemo(() => ({ x: Math.min(full.x, kMovingGridSize), y: Math.min(full.y, kMovingGridSize) }), [full]);
  const fine = useMemo(() => gridGeometry(full), [full]);
  const rough = useMemo(() => gridGeometry(coarse), [coarse]);
  useEffect(
    () => () => {
      fine.dispose();
      rough.dispose();
    },
    [fine, rough]
  );
  const ref = useRef<Mesh>(null);
  const seen = useRef({ view: new Matrix4(), projection: new Matrix4(), changed: -Infinity });
  useFrame(({ camera }) => {
    const s = seen.current;
    const now = performance.now();
    if (!s.view.equals(camera.matrixWorld) || !s.projection.equals(camera.projectionMatrix) || moving()) {
      s.view.copy(camera.matrixWorld);
      s.projection.copy(camera.projectionMatrix);
      s.changed = now;
    }
    const mesh = ref.current;
    if (!mesh) return;
    const sharp = now - s.changed >= kSettleMs;
    const [geometry, cells] = sharp ? [fine, full] : [rough, coarse];
    const uCells = (mesh.material as ShaderMaterial).uniforms.uCells.value;
    if (mesh.geometry !== geometry || uCells.x !== cells.x || uCells.y !== cells.y) {
      mesh.geometry = geometry;
      uCells.set(cells.x, cells.y);
    }
  });
  return { ref, geometry: rough };
}
