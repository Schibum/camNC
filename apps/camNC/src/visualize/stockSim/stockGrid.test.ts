import { Matrix4 } from 'three';
import { describe, expect, it } from 'vitest';
import { gridCells, gridGeometry, kMaxGridSize, sameMatrix, softwareRendering } from './stockGrid';

describe('stock surface grid', () => {
  it('one cell per heightmap texel, up to the largest grid', () => {
    expect(gridCells({ width: 1500, height: 800 })).toEqual({ x: 1500, y: 800 });
    expect(gridCells({ width: 4096, height: 2100 })).toEqual({ x: kMaxGridSize, y: kMaxGridSize });
  });

  it('holds one row of indices and no vertex buffers: rows are instances, positions come from the vertex ids', () => {
    const g = gridGeometry({ x: 2048, y: 2048 });
    expect(g.instanceCount).toBe(2048);
    expect(g.index!.count).toBe(2048 * 6);
    expect(Object.keys(g.attributes)).toEqual([]);
    // Two triangles per cell between column i's lower (2i) and upper (2i + 1) corners and column i + 1's.
    expect([...g.index!.array.slice(0, 6)]).toEqual([0, 2, 1, 1, 2, 3]);
    expect(Math.max(...g.index!.array)).toBe(2 * 2048 + 1);
  });

  it('tells software renderers from GPUs', () => {
    const gl = (renderer: string | null) =>
      ({
        getExtension: () => (renderer ? { UNMASKED_RENDERER_WEBGL: 1 } : null),
        getParameter: () => renderer,
      }) as unknown as WebGL2RenderingContext;
    expect(softwareRendering(gl('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)'))).toBe(true);
    expect(softwareRendering(gl('llvmpipe (LLVM 15.0.7, 256 bits)'))).toBe(true);
    expect(softwareRendering(gl('ANGLE (Apple, ANGLE Metal Renderer: Apple M1 Max, Unspecified Version)'))).toBe(false);
    // Unknown: a GPU, so nobody gets the coarser picture without need.
    expect(softwareRendering(gl(null))).toBe(false);
  });

  it('a camera counts as still despite rounding errors, but not after a move or zoom you can see', () => {
    const camera = new Matrix4().makeRotationY(0.5).setPosition(300, 400, 500);
    const rounded = camera.clone();
    rounded.elements[1] += 1e-14;
    rounded.elements[12] += 1e-11;
    expect(sameMatrix(camera, rounded)).toBe(true);
    expect(sameMatrix(camera, new Matrix4().makeRotationY(0.51).setPosition(300, 400, 500))).toBe(false);
    expect(sameMatrix(camera, new Matrix4().makeRotationY(0.5).setPosition(301, 400, 500))).toBe(false);
    // An orthographic projection's scale is tiny in mm: 1% zoom is still a change.
    const scale = (s: number) => new Matrix4().makeScale(s, s, s);
    expect(sameMatrix(scale(0.001), scale(0.00101))).toBe(false);
  });
});
