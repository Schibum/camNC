/// <reference types="@webgpu/types" />

import { Matrix3, Vector3 } from 'three';
import { makeShaderDataDefinitions, makeStructuredView } from 'webgpu-utils';
import { REMAP_PARAMS_STRUCT, UNDISTORT_WGSL } from './sharedShaders';
import { createRemapUniform, generateMachineToCamMatrix, padMat3 } from './webgpu-helpers';

export interface WebGPUPipelineStep<TParams> {
  /**
   * Run the GPU step.
   * @param srcTex Source texture to read from (must have TEXTURE_BINDING usage).
   * @param params Parameters for this processing step (not cached in the step instance).
   * @param dstTex Optional destination texture. If omitted the step will lazily allocate its own
   *               output texture that matches the expected descriptor. When provided the caller is
   *               responsible for keeping / re-using the texture across frames which avoids
   *               per-frame allocations.
   * @returns The texture that now contains the processed result – i.e. `dstTex` if it was
   *          supplied, otherwise the internally allocated texture.
   */
  process(srcTex: GPUTexture, params: TParams, dstTex?: GPUTexture): Promise<GPUTexture>;
}

export interface RemapStepParams {
  outputSize: [number, number];
  machineBounds: [number, number, number, number];
  // intrinsics
  cameraMatrix: Matrix3;
  newCameraMatrix: Matrix3;
  distCoeffs: number[];
  // extrinsics
  R: Matrix3;
  t: Vector3;
  // optional, computed from intrinsics and extrinsics if not provided
  combinedProjectionMatrix?: Matrix3;
}

export class CamToMachineStep implements WebGPUPipelineStep<RemapStepParams> {
  private device: GPUDevice;
  private pipeline: GPUComputePipeline;
  private sampler: GPUSampler;

  constructor(device: GPUDevice) {
    this.device = device;
    this.pipeline = this.createPipeline();
    this.sampler = this.device.createSampler();
  }

  private shaderCode(): string {
    return /* wgsl */ `
${REMAP_PARAMS_STRUCT}

@group(0) @binding(0) var srcTex: texture_2d<f32>; // raw camera frame
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var<uniform> params: RemapParams;
@group(0) @binding(3) var dstTex: texture_storage_2d<rgba8unorm, write>;

${UNDISTORT_WGSL}

@compute @workgroup_size(8,8)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let dstSize = textureDimensions(dstTex);
  if (gid.x >= dstSize.x || gid.y >= dstSize.y) { return; }
  let srcSize = textureDimensions(srcTex);

  // ==== Phase 1: machine → undistorted pixel (u,v) ====
  let xRange = params.bounds.z - params.bounds.x;
  let yRange = params.bounds.w - params.bounds.y;
  let X = params.bounds.x + (f32(gid.x) + 0.5) / f32(dstSize.x) * xRange;
  let Y = params.bounds.y + (f32(gid.y) + 0.5) / f32(dstSize.y) * yRange;
  let p = params.matrix * vec3<f32>(X, Y, 1.0);
  let u = p.x / p.z;
  let v = p.y / p.z;

  // ==== Phase 2: use shared undistort helper to map to raw camera coords ====
  let srcPos = undistort_uv(u, v);
  var srcX = srcPos.x;
  var srcY = srcPos.y;

  var color : vec4<f32> = vec4f(0.0,0.0,0.0,1.0);
  if (srcX >= 0.0 && srcY >= 0.0 && srcX < f32(srcSize.x) && srcY < f32(srcSize.y)) {
    let uv = vec2<f32>(srcX, srcY) / vec2<f32>(f32(srcSize.x), f32(srcSize.y));
    color = textureSampleLevel(srcTex, samp, uv, 0.0);
  }
  textureStore(dstTex, vec2<i32>(i32(gid.x), i32(gid.y)), color);
}`;
  }

  private createPipeline(): GPUComputePipeline {
    const shader = this.device.createShaderModule({ code: this.shaderCode() });
    return this.device.createComputePipeline({ layout: 'auto', compute: { module: shader, entryPoint: 'main' } });
  }

  async process(camTexture: GPUTexture, params: RemapStepParams, dstTex?: GPUTexture): Promise<GPUTexture> {
    const [width, height] = params.outputSize;

    // Use caller-supplied destination texture if given, otherwise create one on-the-fly.
    const dst =
      dstTex ??
      this.device.createTexture({
        label: 'CamToMachineStep output texture',
        size: [width, height],
        format: 'rgba8unorm',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC | GPUTextureUsage.STORAGE_BINDING,
      });
    const defs = makeShaderDataDefinitions(this.shaderCode());
    const paramsValues = makeStructuredView(defs.uniforms.params);

    createRemapUniform(params, paramsValues);
    const uniformBuffer = this.device.createBuffer({
      label: 'CamToMachineStep uniform buffer',
      size: paramsValues.arrayBuffer.byteLength,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(uniformBuffer, 0, paramsValues.arrayBuffer);

    const bindGroup = this.device.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: camTexture.createView() },
        { binding: 1, resource: this.sampler },
        { binding: 2, resource: { buffer: uniformBuffer } },
        { binding: 3, resource: dst.createView() },
      ],
    });

    const commandEncoder = this.device.createCommandEncoder();
    const pass = commandEncoder.beginComputePass();
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(Math.ceil(width / 8), Math.ceil(height / 8));
    pass.end();
    this.device.queue.submit([commandEncoder.finish()]);

    uniformBuffer.destroy();

    return dst;
  }
}

export class MachineToCamStep implements WebGPUPipelineStep<{ params: RemapStepParams; scale: [number, number] }> {
  private device: GPUDevice;
  private pipeline: GPUComputePipeline;
  private sampler: GPUSampler;

  constructor(device: GPUDevice) {
    this.device = device;
    this.pipeline = this.createPipeline();
    this.sampler = this.device.createSampler();
  }

  private shaderCode(): string {
    const common = /* wgsl */ `struct Params {
  matrix : mat3x3<f32>,
  bounds : vec4<f32>,
  scale  : vec2<f32>,
};

@group(0) @binding(0) var srcTex: texture_2d<f32>;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var<uniform> params: Params;
@group(0) @binding(3) var dstTex: texture_storage_2d<rgba8unorm, write>;`;
    const machineToCam = /* wgsl */ `
  let camX = (f32(gid.x) + 0.5) * params.scale.x;
  let camY = (f32(gid.y) + 0.5) * params.scale.y;
  let p = params.matrix * vec3<f32>(camX, camY, 1.0);
  let X = p.x / p.z;
  let Y = p.y / p.z;
  let mx = (X - params.bounds.x) / (params.bounds.z - params.bounds.x);
  let my = (Y - params.bounds.y) / (params.bounds.w - params.bounds.y);
  let sx = mx * f32(srcSize.x);
  let sy = my * f32(srcSize.y);
  if (sx >= 0.0 && sy >= 0.0 && sx < f32(srcSize.x) && sy < f32(srcSize.y)) {
    let uv = vec2<f32>(sx, sy) / vec2<f32>(f32(srcSize.x), f32(srcSize.y));
    color = textureSampleLevel(srcTex, samp, uv, 0.0);
  }`;
    return /* wgsl */ `${common}

@compute @workgroup_size(8,8)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let dstSize = textureDimensions(dstTex);
  if (gid.x >= dstSize.x || gid.y >= dstSize.y) { return; }
  let srcSize = textureDimensions(srcTex);
  var color : vec4<f32> = vec4f(0.0,0.0,0.0,1.0);
  ${machineToCam}
  textureStore(dstTex, vec2<i32>(i32(gid.x), i32(gid.y)), color);
}`;
  }

  private createPipeline(): GPUComputePipeline {
    const shader = this.device.createShaderModule({ code: this.shaderCode() });
    return this.device.createComputePipeline({
      layout: 'auto',
      compute: {
        module: shader,
        entryPoint: 'main',
      },
    });
  }

  async process(
    texture: GPUTexture,
    { params, scale }: { params: RemapStepParams; scale: [number, number] },
    dstTex?: GPUTexture
  ): Promise<GPUTexture> {
    const [width, height] = params.outputSize;
    const dst =
      dstTex ??
      this.device.createTexture({
        label: 'MachineToCamStep output texture',
        size: [width, height],
        format: 'rgba8unorm',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC | GPUTextureUsage.STORAGE_BINDING,
      });

    const defs = makeShaderDataDefinitions(this.shaderCode());
    const paramsValues = makeStructuredView(defs.uniforms.params);

    paramsValues.set({
      matrix: padMat3(generateMachineToCamMatrix(params)),
      bounds: params.machineBounds,
      scale,
    });

    const uniformBuffer = this.device.createBuffer({
      label: 'MachineToCamStep uniform buffer',
      size: paramsValues.arrayBuffer.byteLength,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(uniformBuffer, 0, paramsValues.arrayBuffer);

    const bindGroup = this.device.createBindGroup({
      label: 'MachineToCamStep bind group',
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: texture.createView() },
        { binding: 1, resource: this.sampler },
        { binding: 2, resource: { buffer: uniformBuffer } },
        { binding: 3, resource: dst.createView() },
      ],
    });

    const commandEncoder = this.device.createCommandEncoder();
    const pass = commandEncoder.beginComputePass();
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, bindGroup);
    const workgroupsX = Math.ceil(width / 8);
    const workgroupsY = Math.ceil(height / 8);
    pass.dispatchWorkgroups(workgroupsX, workgroupsY);
    pass.end();
    this.device.queue.submit([commandEncoder.finish()]);

    uniformBuffer.destroy();

    return dst;
  }
}

export interface UndistortParams {
  outputSize: [number, number];
  cameraMatrix: Matrix3;
  newCameraMatrix: Matrix3;
  distCoeffs: number[];
}

// Undistort is now just a special case of CamToMachineStep with identity
// transform and bounds equal to output pixel extents.
export class UndistortStep implements WebGPUPipelineStep<UndistortParams> {
  private inner: CamToMachineStep;

  constructor(device: GPUDevice) {
    this.inner = new CamToMachineStep(device);
  }

  process(texture: GPUTexture, params: UndistortParams, dstTex?: GPUTexture): Promise<GPUTexture> {
    const [w, h] = params.outputSize;
    const identity = new Matrix3().identity();
    const innerParams: RemapStepParams = {
      outputSize: params.outputSize,
      machineBounds: [0, 0, w, h],
      combinedProjectionMatrix: identity,
      cameraMatrix: params.cameraMatrix,
      newCameraMatrix: params.newCameraMatrix,
      distCoeffs: params.distCoeffs,
      R: identity,
      t: new Vector3(0, 0, 0),
    } as RemapStepParams;
    return this.inner.process(texture, innerParams, dstTex);
  }
}
