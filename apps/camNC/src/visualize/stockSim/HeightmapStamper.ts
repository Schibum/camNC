import {
  Box2,
  BufferGeometry,
  Camera,
  DepthTexture,
  DoubleSide,
  Float32BufferAttribute,
  FloatType,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  LessEqualDepth,
  Mesh,
  RawShaderMaterial,
  GLSL3,
  RedFormat,
  Scene,
  UnsignedByteType,
  WebGLRenderer,
  WebGLRenderTarget,
} from 'three';
import { ParsedToolpath } from '../gcodeParsing';
import { isRapidSegment } from '../depthInspection';
import { Playhead } from './jobTimeline';
import { ToolShape } from './toolShapes';

const kToolKindIds = { flat: 0, ball: 1, vbit: 2 } as const;

/** Area and depth range the heightmap covers, in toolpath (work) coordinates. */
export interface HeightmapDomain {
  footprint: Box2;
  /** Stock top. The heightmap starts out at this height. */
  zTop: number;
  /** Lowest representable height, below the stock bottom and the deepest cut. */
  zLow: number;
  width: number;
  height: number;
}

/** Texel size about 0.1 mm for small parts, coarser for large ones so the texture stays within `maxSize`. */
export function heightmapSize(footprint: Box2, maxSize: number, minCell = 0.1) {
  const sizeX = footprint.max.x - footprint.min.x;
  const sizeY = footprint.max.y - footprint.min.y;
  const cell = Math.max(minCell, Math.max(sizeX, sizeY) / maxSize);
  return { width: Math.max(2, Math.ceil(sizeX / cell)), height: Math.max(2, Math.ceil(sizeY / cell)), cell };
}

// Vertex shader: each instance is one segment, drawn as a rectangle that covers everything the tool can touch
// while moving along it. Positions map straight to clip space: X/Y over the footprint, depth from the tool height.
const kStampVertex = /* glsl */ `
  precision highp float;
  in vec2 corner; // x: 0 at the start, 1 at the end; y: -1 / 1 for the two sides
  in vec3 aStart;
  in vec3 aEnd;
  in vec3 aTool; // kind, radius (< 0: skip), 1 / tan(half angle)
  uniform vec4 uFootprint; // min x, min y, size x, size y
  uniform float uPad;
  uniform int uFrom;
  out vec2 vXY;
  flat out vec3 vStart;
  flat out vec3 vEnd;
  flat out vec3 vTool;
  void main() {
    vStart = aStart;
    vEnd = aEnd;
    vTool = aTool;
    if (gl_InstanceID < uFrom || aTool.y < 0.0) {
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      return;
    }
    vec2 d = aEnd.xy - aStart.xy;
    float len = length(d);
    vec2 dir = len > 1e-6 ? d / len : vec2(1.0, 0.0);
    vec2 normal = vec2(-dir.y, dir.x);
    float r = aTool.y + uPad;
    vec2 xy = mix(aStart.xy, aEnd.xy, corner.x) + dir * (corner.x * 2.0 - 1.0) * r + normal * corner.y * r;
    vXY = xy;
    vec2 ndc = (xy - uFootprint.xy) / uFootprint.zw * 2.0 - 1.0;
    gl_Position = vec4(ndc, 0.0, 1.0);
  }
`;

// Fragment shader: lowest point of the tool over this texel during the move, the same method as `sweptToolDepth`.
const kStampFragment = /* glsl */ `
  precision highp float;
  in vec2 vXY;
  flat in vec3 vStart;
  flat in vec3 vEnd;
  flat in vec3 vTool;
  uniform vec2 uZRange; // low, top
  out vec4 outColor;

  float profile(float d, float r) {
    if (vTool.x < 0.5) return 0.0;
    if (vTool.x < 1.5) return r - sqrt(max(r * r - d * d, 0.0));
    return d * vTool.z;
  }

  float depthAt(float t, vec2 o, vec2 dxy, float r) {
    float d = min(length(o + t * dxy), r);
    return mix(vStart.z, vEnd.z, t) + profile(d, r);
  }

  void main() {
    float r = vTool.y;
    vec2 dxy = vEnd.xy - vStart.xy;
    vec2 o = vStart.xy - vXY;
    float len2 = dot(dxy, dxy);
    float t0 = 0.0;
    float t1 = 1.0;
    float closest = 0.0;
    if (len2 < 1e-12) {
      if (dot(o, o) > r * r) discard;
    } else {
      float b = dot(o, dxy) / len2;
      float c = (dot(o, o) - r * r) / len2;
      float disc = b * b - c;
      if (disc < 0.0) discard;
      float s = sqrt(disc);
      t0 = max(-b - s, 0.0);
      t1 = min(-b + s, 1.0);
      if (t0 > t1) discard;
      closest = clamp(-b, t0, t1);
    }
    float z = min(depthAt(t0, o, dxy, r), depthAt(t1, o, dxy, r));
    if (vTool.x > 0.5) {
      z = min(z, depthAt(closest, o, dxy, r));
      for (int i = 1; i < 8; i++) z = min(z, depthAt(mix(t0, t1, float(i) / 8.0), o, dxy, r));
    }
    gl_FragDepth = clamp((z - uZRange.x) / (uZRange.y - uZRange.x), 0.0, 1.0);
    outColor = vec4(0.0);
  }
`;

function createStampMaterial(domain: HeightmapDomain) {
  const { footprint } = domain;
  const cell = Math.max((footprint.max.x - footprint.min.x) / domain.width, (footprint.max.y - footprint.min.y) / domain.height);
  return new RawShaderMaterial({
    glslVersion: GLSL3,
    vertexShader: kStampVertex,
    fragmentShader: kStampFragment,
    uniforms: {
      uFootprint: {
        value: [footprint.min.x, footprint.min.y, footprint.max.x - footprint.min.x, footprint.max.y - footprint.min.y],
      },
      uPad: { value: cell * 1.5 },
      uFrom: { value: 0 },
      uZRange: { value: [domain.zLow, domain.zTop] },
    },
    depthTest: true,
    depthWrite: true,
    depthFunc: LessEqualDepth,
    colorWrite: false,
    side: DoubleSide,
  });
}

function createQuad<T extends BufferGeometry>(geometry: T): T {
  geometry.setAttribute('corner', new Float32BufferAttribute([0, -1, 1, -1, 1, 1, 0, 1], 2));
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  return geometry;
}

/**
 * Simulated stock as a heightmap on the GPU: a depth texture over the stock footprint that holds the lowest height
 * the tool has reached at each texel. Segments are drawn as swept tool shapes, and the depth test keeps the
 * deepest cut. Moving the playhead forward only draws the new segments; moving it back starts over.
 */
export class HeightmapStamper {
  readonly target: WebGLRenderTarget;
  readonly domain: HeightmapDomain;
  private readonly scene = new Scene();
  private readonly camera = new Camera();
  private readonly material: RawShaderMaterial;
  private readonly segments: InstancedBufferGeometry;
  private readonly partial: InstancedBufferGeometry;
  private readonly partialStart: InstancedBufferAttribute;
  private readonly partialEnd: InstancedBufferAttribute;
  private readonly partialTool: InstancedBufferAttribute;
  private readonly segmentMesh: Mesh;
  private readonly partialMesh: Mesh;
  private readonly starts: Float32Array;
  private readonly ends: Float32Array;
  private readonly tools: Float32Array;
  private readonly count: number;
  // Segments 1..done are stamped completely, plus `partialFraction` of segment done + 1.
  private done = -1;
  private partialFraction = 0;

  constructor(toolpath: ParsedToolpath, domain: HeightmapDomain, toolShapeOf: (tool: number | undefined) => ToolShape) {
    this.domain = domain;
    const depthTexture = new DepthTexture(domain.width, domain.height, FloatType);
    this.target = new WebGLRenderTarget(domain.width, domain.height, {
      format: RedFormat,
      type: UnsignedByteType,
      depthBuffer: true,
      depthTexture,
    });

    // Instance i is the segment ending at path point i + 1.
    const points = toolpath.pathPoints;
    this.count = Math.max(points.length - 1, 0);
    this.starts = new Float32Array(this.count * 3);
    this.ends = new Float32Array(this.count * 3);
    this.tools = new Float32Array(this.count * 3);
    const shapes = new Map<number | undefined, ToolShape>();
    for (let i = 0; i < this.count; i++) {
      const a = points[i];
      const b = points[i + 1];
      this.starts.set([a.x, a.y, a.z], i * 3);
      this.ends.set([b.x, b.y, b.z], i * 3);
      const toolNumber = toolpath.modals[i + 1]?.tool;
      if (!shapes.has(toolNumber)) shapes.set(toolNumber, toolShapeOf(toolNumber));
      const shape = shapes.get(toolNumber)!;
      // Rapids are not stamped: moves before the first position is known (from the assumed origin) and machine
      // coordinate moves (G53, G28) are reported as work coordinate rapids and would cut into the stock.
      const skip = isRapidSegment(toolpath, i + 1);
      this.tools.set(toolData(shape, skip), i * 3);
    }

    this.material = createStampMaterial(domain);
    this.segments = createQuad(new InstancedBufferGeometry());
    this.segments.setAttribute('aStart', new InstancedBufferAttribute(this.starts, 3));
    this.segments.setAttribute('aEnd', new InstancedBufferAttribute(this.ends, 3));
    this.segments.setAttribute('aTool', new InstancedBufferAttribute(this.tools, 3));
    this.segments.instanceCount = 0;

    this.partial = createQuad(new InstancedBufferGeometry());
    this.partialStart = new InstancedBufferAttribute(new Float32Array(3), 3);
    this.partialEnd = new InstancedBufferAttribute(new Float32Array(3), 3);
    this.partialTool = new InstancedBufferAttribute(new Float32Array(3), 3);
    this.partial.setAttribute('aStart', this.partialStart);
    this.partial.setAttribute('aEnd', this.partialEnd);
    this.partial.setAttribute('aTool', this.partialTool);
    this.partial.instanceCount = 1;

    this.segmentMesh = new Mesh(this.segments, this.material);
    this.partialMesh = new Mesh(this.partial, this.material);
    for (const mesh of [this.segmentMesh, this.partialMesh]) {
      mesh.frustumCulled = false;
      this.scene.add(mesh);
    }
  }

  get depthTexture() {
    return this.target.depthTexture!;
  }

  /** Brings the heightmap to the state at `playhead`. */
  update(renderer: WebGLRenderer, { index, fraction }: Playhead) {
    if (this.count === 0) return;
    // Complete segments: instances 0 .. full - 1.
    const full = Math.min(fraction >= 1 ? index : index - 1, this.count);
    const partialFraction = fraction >= 1 ? 0 : fraction;
    if (full === this.done && partialFraction === this.partialFraction) return;

    const previousTarget = renderer.getRenderTarget();
    const autoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.setRenderTarget(this.target);
    const backwards = full < this.done || (full === this.done && partialFraction < this.partialFraction);
    let from = Math.max(this.done, 0);
    if (this.done < 0 || backwards) {
      renderer.clear(false, true, false);
      from = 0;
    }

    this.segmentMesh.visible = full > from;
    this.segments.instanceCount = full;
    this.material.uniforms.uFrom.value = from;
    this.partialMesh.visible = partialFraction > 0 && full < this.count;
    if (this.partialMesh.visible) this.setPartial(full, partialFraction);
    renderer.render(this.scene, this.camera);

    renderer.setRenderTarget(previousTarget);
    renderer.autoClear = autoClear;
    this.material.uniforms.uFrom.value = 0;
    this.done = full;
    this.partialFraction = partialFraction;
  }

  private setPartial(instance: number, fraction: number) {
    const i = instance * 3;
    const start = this.starts.subarray(i, i + 3);
    const end = this.ends.subarray(i, i + 3);
    (this.partialStart.array as Float32Array).set(start);
    (this.partialEnd.array as Float32Array).set(start.map((s, k) => s + (end[k] - s) * fraction));
    (this.partialTool.array as Float32Array).set(this.tools.subarray(i, i + 3));
    this.partialStart.needsUpdate = true;
    this.partialEnd.needsUpdate = true;
    this.partialTool.needsUpdate = true;
  }

  dispose() {
    this.target.depthTexture?.dispose();
    this.target.dispose();
    this.material.dispose();
    this.segments.dispose();
    this.partial.dispose();
  }
}

function toolData(shape: ToolShape, skip: boolean): [number, number, number] {
  const cot = shape.kind === 'vbit' ? 1 / Math.tan(((shape.halfAngle ?? 45) * Math.PI) / 180) : 0;
  return [kToolKindIds[shape.kind], skip ? -1 : shape.radius, cot];
}
