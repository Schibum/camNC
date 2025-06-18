/// <reference types="@webgpu/types" />

import { Matrix3 } from 'three';

export interface WebGPUPipelineStep {
  process(texture: GPUTexture): Promise<GPUTexture>;
}

export interface RemapStepParams {
  outputSize: [number, number];
  machineBounds: [number, number, number, number];
  matrix: Float32Array; // 3x3 transform
}

interface MatrixParams {
  K: Float32Array;
  R: Float32Array;
  t: Float32Array;
}

function computeMatrix({ K, R, t }: MatrixParams): Matrix3 {
  const extr = new Matrix3().set(
    Number(R[0]),
    Number(R[3]),
    Number(t[0]),
    Number(R[1]),
    Number(R[4]),
    Number(t[1]),
    Number(R[2]),
    Number(R[5]),
    Number(t[2])
  );
  return new Matrix3().multiplyMatrices(new Matrix3().fromArray(K), extr);
}

export function generateCamToMachineMatrix(params: MatrixParams) {
  return computeMatrix(params).toArray();
}

export function generateMachineToCamMatrix(params: MatrixParams) {
  return computeMatrix(params).invert().toArray();
}

class BaseRemapStep implements WebGPUPipelineStep {
  private device: GPUDevice;
  private pipeline: GPUComputePipeline;
  private bindGroup: GPUBindGroup | null = null;
  private params: RemapStepParams;

  constructor(device: GPUDevice, params: RemapStepParams, direction: 'camToMachine' | 'machineToCam') {
    this.device = device;
    this.params = params;
    this.pipeline = this.createPipeline(direction);
  }

  private shaderCode(direction: 'camToMachine' | 'machineToCam'): string {
    const common = `struct Params {
  matrix : mat3x3<f32>,
  bounds : vec4<f32>,
};

@group(0) @binding(0) var srcTex: texture_2d<f32>;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var<uniform> params: Params;
@group(0) @binding(3) var dstTex: texture_storage_2d<rgba8unorm, write>;`;
    const camToMachine = `let xRange = params.bounds.z - params.bounds.x;
  let yRange = params.bounds.w - params.bounds.y;
  let X = params.bounds.x + (f32(gid.x) + 0.5) / f32(dstSize.x) * xRange;
  let Y = params.bounds.y + (f32(gid.y) + 0.5) / f32(dstSize.y) * yRange;
  let p = params.matrix * vec3<f32>(X, Y, 1.0);
  let sx = p.x / p.z;
  let sy = p.y / p.z;
  if (sx >= 0.0 && sy >= 0.0 && sx < f32(srcSize.x) && sy < f32(srcSize.y)) {
    let uv = vec2<f32>(sx, sy) / vec2<f32>(f32(srcSize.x), f32(srcSize.y));
    color = textureSampleLevel(srcTex, samp, uv, 0.0);
  }`;
    const machineToCam = `let p = params.matrix * vec3<f32>(f32(gid.x) + 0.5, f32(gid.y) + 0.5, 1.0);
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
    const body = direction === 'camToMachine' ? camToMachine : machineToCam;
    return `${common}

@compute @workgroup_size(8,8)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let dstSize = textureDimensions(dstTex);
  if (gid.x >= dstSize.x || gid.y >= dstSize.y) { return; }
  let srcSize = textureDimensions(srcTex);
  var color : vec4<f32> = vec4f(0.0,0.0,0.0,1.0);
  ${body}
  textureStore(dstTex, vec2<i32>(i32(gid.x), i32(gid.y)), color);
}`;
  }

  private createPipeline(direction: 'camToMachine' | 'machineToCam'): GPUComputePipeline {
    const shader = this.device.createShaderModule({ code: this.shaderCode(direction) });

    return this.device.createComputePipeline({
      layout: 'auto',
      compute: {
        module: shader,
        entryPoint: 'main',
      },
    });
  }

  async process(texture: GPUTexture): Promise<GPUTexture> {
    const [width, height] = this.params.outputSize;
    const dst = this.device.createTexture({
      size: [width, height],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC | GPUTextureUsage.STORAGE_BINDING,
    });

    const uniformData = new Float32Array(16);
    uniformData.set(this.params.matrix, 0);
    uniformData.set(this.params.machineBounds, 9);

    const uniformBuffer = this.device.createBuffer({
      size: uniformData.byteLength,
      usage: GPUBufferUsage.UNIFORM,
      mappedAtCreation: true,
    });
    new Float32Array(uniformBuffer.getMappedRange()).set(uniformData);
    uniformBuffer.unmap();

    this.bindGroup = this.device.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: texture.createView() },
        { binding: 1, resource: this.device.createSampler() },
        { binding: 2, resource: { buffer: uniformBuffer } },
        { binding: 3, resource: dst.createView() },
      ],
    });

    const commandEncoder = this.device.createCommandEncoder();
    const pass = commandEncoder.beginComputePass();
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.bindGroup);
    const workgroupsX = Math.ceil(width / 8);
    const workgroupsY = Math.ceil(height / 8);
    pass.dispatchWorkgroups(workgroupsX, workgroupsY);
    pass.end();
    this.device.queue.submit([commandEncoder.finish()]);

    return dst;
  }
}

export class CamToMachineStep extends BaseRemapStep {
  constructor(device: GPUDevice, params: RemapStepParams) {
    super(device, params, 'camToMachine');
  }
}

export class MachineToCamStep extends BaseRemapStep {
  constructor(device: GPUDevice, params: RemapStepParams) {
    super(device, params, 'machineToCam');
  }
}

export interface UndistortParams {
  outputSize: [number, number];
  cameraMatrix: Float32Array; // 3x3
  newCameraMatrix: Float32Array; // 3x3
  distCoeffs: Float32Array; // [k1,k2,p1,p2,k3]
  R?: Float32Array; // 3x3 rectification matrix
}

export class UndistortStep implements WebGPUPipelineStep {
  private device: GPUDevice;
  private pipeline: GPUComputePipeline;
  private bindGroup: GPUBindGroup | null = null;
  private params: UndistortParams;

  constructor(device: GPUDevice, params: UndistortParams) {
    this.device = device;
    this.params = { ...params, R: params.R ?? Float32Array.from([1, 0, 0, 0, 1, 0, 0, 0, 1]) };
    this.pipeline = this.createPipeline();
  }

  private shaderCode(): string {
    return `struct Params {
  cameraMatrix : mat3x3<f32>,
  newCameraMatrix : mat3x3<f32>,
  R : mat3x3<f32>,
  distCoeffs : vec4<f32>,
  k3 : f32,
};

@group(0) @binding(0) var srcTex: texture_2d<f32>;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var<uniform> params: Params;
@group(0) @binding(3) var dstTex: texture_storage_2d<rgba8unorm, write>;

@compute @workgroup_size(8,8)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let dstSize = textureDimensions(dstTex);
  if (gid.x >= dstSize.x || gid.y >= dstSize.y) { return; }
  let srcSize = textureDimensions(srcTex);
  let u = f32(gid.x) + 0.5;
  let v = f32(gid.y) + 0.5;
  let fx_new = params.newCameraMatrix[0][0];
  let fy_new = params.newCameraMatrix[1][1];
  let cx_new = params.newCameraMatrix[2][0];
  let cy_new = params.newCameraMatrix[2][1];
  var nx = (u - cx_new) / fx_new;
  var ny = (v - cy_new) / fy_new;
  var vec = params.R * vec3<f32>(nx, ny, 1.0);
  var x = vec.x / vec.z;
  var y = vec.y / vec.z;
  var r2 = x * x + y * y;
  var radial = 1.0 + params.distCoeffs.x * r2 + params.distCoeffs.y * r2 * r2 + params.k3 * r2 * r2 * r2;
  var deltaX = 2.0 * params.distCoeffs.z * x * y + params.distCoeffs.w * (r2 + 2.0 * x * x);
  var deltaY = params.distCoeffs.z * (r2 + 2.0 * y * y) + 2.0 * params.distCoeffs.w * x * y;
  var xd = x * radial + deltaX;
  var yd = y * radial + deltaY;
  let fx = params.cameraMatrix[0][0];
  let fy = params.cameraMatrix[1][1];
  let cx = params.cameraMatrix[2][0];
  let cy = params.cameraMatrix[2][1];
  var srcX = fx * xd + cx;
  var srcY = fy * yd + cy;
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
    return this.device.createComputePipeline({
      layout: 'auto',
      compute: { module: shader, entryPoint: 'main' },
    });
  }

  async process(texture: GPUTexture): Promise<GPUTexture> {
    const [width, height] = this.params.outputSize;
    const dst = this.device.createTexture({
      size: [width, height],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC | GPUTextureUsage.STORAGE_BINDING,
    });

    const uniformData = new Float32Array(9 + 9 + 9 + 4 + 1);
    let offset = 0;
    uniformData.set(this.params.cameraMatrix, offset);
    offset += 9;
    uniformData.set(this.params.newCameraMatrix, offset);
    offset += 9;
    uniformData.set(this.params.R!, offset);
    offset += 9;
    uniformData.set(this.params.distCoeffs.subarray(0, 4), offset);
    offset += 4;
    uniformData[offset] = this.params.distCoeffs[4] || 0;

    const uniformBuffer = this.device.createBuffer({
      size: uniformData.byteLength,
      usage: GPUBufferUsage.UNIFORM,
      mappedAtCreation: true,
    });
    new Float32Array(uniformBuffer.getMappedRange()).set(uniformData);
    uniformBuffer.unmap();

    this.bindGroup = this.device.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: texture.createView() },
        { binding: 1, resource: this.device.createSampler() },
        { binding: 2, resource: { buffer: uniformBuffer } },
        { binding: 3, resource: dst.createView() },
      ],
    });

    const commandEncoder = this.device.createCommandEncoder();
    const pass = commandEncoder.beginComputePass();
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.bindGroup);
    const workgroupsX = Math.ceil(width / 8);
    const workgroupsY = Math.ceil(height / 8);
    pass.dispatchWorkgroups(workgroupsX, workgroupsY);
    pass.end();
    this.device.queue.submit([commandEncoder.finish()]);
    return dst;
  }
}
