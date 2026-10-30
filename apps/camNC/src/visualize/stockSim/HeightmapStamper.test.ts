import { afterAll, describe, expect, it } from 'vitest';
import {
  Box2,
  Camera,
  FloatType,
  Mesh,
  PlaneGeometry,
  RGBAFormat,
  Scene,
  ShaderMaterial,
  Vector2,
  WebGLRenderer,
  WebGLRenderTarget,
} from 'three';
import { parseGCode } from '../gcodeParsing';
import { HeightmapDomain, HeightmapStamper } from './HeightmapStamper';
import { computeJobTimes, playheadAt } from './jobTimeline';
import { sweptToolDepth, ToolShape } from './toolShapes';

const renderer = new WebGLRenderer({ canvas: document.createElement('canvas') });
afterAll(() => renderer.dispose());

/** Heights (toolpath Z) of the stamper's heightmap, read back through a float render target. */
function readHeights(stamper: HeightmapStamper) {
  const { width, height, zLow, zTop } = stamper.domain;
  const target = new WebGLRenderTarget(width, height, { type: FloatType, format: RGBAFormat });
  const material = new ShaderMaterial({
    uniforms: { uDepth: { value: stamper.depthTexture }, uRange: { value: [zLow, zTop] } },
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy * 2.0, 0.0, 1.0); }',
    fragmentShader:
      'uniform sampler2D uDepth; uniform vec2 uRange; varying vec2 vUv; void main() { gl_FragColor = vec4(mix(uRange.x, uRange.y, texture(uDepth, vUv).r)); }',
  });
  const scene = new Scene();
  scene.add(new Mesh(new PlaneGeometry(1, 1), material));
  renderer.setRenderTarget(target);
  renderer.render(scene, new Camera());
  renderer.setRenderTarget(null);
  const pixels = new Float32Array(width * height * 4);
  renderer.readRenderTargetPixels(target, 0, 0, width, height, pixels);
  target.dispose();
  material.dispose();
  return (x: number, y: number) => pixels[(y * width + x) * 4];
}

function makeStamper(gcode: string, shape: ToolShape) {
  const toolpath = parseGCode(gcode);
  const domain: HeightmapDomain = {
    footprint: new Box2(new Vector2(-10, -10), new Vector2(30, 10)),
    zTop: 0,
    zLow: -11,
    width: 80,
    height: 40,
  };
  return { toolpath, stamper: new HeightmapStamper(toolpath, domain, () => shape) };
}

/** CPU reference: the deepest swept tool depth over all cutting segments up to `end` (exclusive point index). */
function referenceHeight(toolpath: ReturnType<typeof parseGCode>, shape: ToolShape, x: number, y: number, end: number) {
  let z = 0;
  for (let i = 1; i < end; i++) {
    if (toolpath.modals[i]?.motion === 'G0') continue;
    z = Math.min(z, sweptToolDepth(shape, toolpath.pathPoints[i - 1], toolpath.pathPoints[i], x, y));
  }
  return Math.max(z, -11);
}

const kGcode = 'G0 X0 Y0 Z1\nG1 Z-3 F100\nG1 X20 Y5 Z-5 F500\nG0 Z1\nG0 X5 Y-5\nG1 Z-1\nG1 X15 Y-5\n';

describe('HeightmapStamper', () => {
  for (const shape of [
    { kind: 'flat', radius: 3 },
    { kind: 'ball', radius: 3 },
    { kind: 'vbit', radius: 3, halfAngle: 30 },
  ] as ToolShape[]) {
    it(`matches the CPU reference for a ${shape.kind} tool`, () => {
      const { toolpath, stamper } = makeStamper(kGcode, shape);
      stamper.update(renderer, { index: toolpath.pathPoints.length - 1, fraction: 1 });
      const heightAt = readHeights(stamper);
      let maxError = 0;
      // Texel centers: 0.5 mm cells starting at (-10, -10).
      for (let ty = 0; ty < 40; ty += 3) {
        for (let tx = 0; tx < 80; tx += 3) {
          const expected = referenceHeight(toolpath, shape, -10 + (tx + 0.5) * 0.5, -10 + (ty + 0.5) * 0.5, toolpath.pathPoints.length);
          maxError = Math.max(maxError, Math.abs(heightAt(tx, ty) - expected));
        }
      }
      expect(maxError).toBeLessThan(0.05);
      stamper.dispose();
    });
  }

  it('goes back in time by starting over', () => {
    const shape: ToolShape = { kind: 'flat', radius: 3 };
    const { toolpath, stamper } = makeStamper(kGcode, shape);
    const times = computeJobTimes(toolpath);
    const total = times[times.length - 1];
    stamper.update(renderer, playheadAt(times, total));
    const half = playheadAt(times, total / 2);
    stamper.update(renderer, half);
    const heightAt = readHeights(stamper);
    // The second slot (along y = -5) is cut after the first half.
    expect(heightAt(Math.round((10 + 10) / 0.5), Math.round((-5 + 10) / 0.5))).toBeCloseTo(0, 3);
    // The ramp start is cut.
    expect(heightAt(20, 20)).toBeLessThan(-2.9);
    stamper.dispose();
  });

  it('cuts the segment under the playhead while playing forward', () => {
    const shape: ToolShape = { kind: 'flat', radius: 3 };
    // One long cut along X at Z -2.
    const { toolpath, stamper } = makeStamper('G0 X-5 Y0 Z1\nG1 Z-2 F100\nG1 X25 F500\nG0 Z1\n', shape);
    const last = toolpath.pathPoints.length - 2;
    // Playback: first the start of the long cut, then further along it, as consecutive frames do.
    stamper.update(renderer, { index: last, fraction: 0.1 });
    stamper.update(renderer, { index: last, fraction: 0.6 });
    const heightAt = readHeights(stamper);
    // x = 10 (60 % of the way from -5 to 25) is cut, x = 20 is not yet.
    expect(heightAt(Math.round((9 + 10) / 0.5), 20)).toBeCloseTo(-2, 2);
    expect(heightAt(Math.round((20 + 10) / 0.5), 20)).toBeCloseTo(0, 2);
    stamper.dispose();
  });
});
