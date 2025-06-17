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
    const common = `struct Params {\n  matrix : mat3x3<f32>,\n  bounds : vec4<f32>,\n};\n\n@group(0) @binding(0) var srcTex: texture_2d<f32>;\n@group(0) @binding(1) var samp: sampler;\n@group(0) @binding(2) var<uniform> params: Params;\n@group(0) @binding(3) var dstTex: texture_storage_2d<rgba8unorm, write>;`;
    const camToMachine = `let xRange = params.bounds.z - params.bounds.x;\n  let yRange = params.bounds.w - params.bounds.y;\n  let X = params.bounds.x + (f32(gid.x) + 0.5) / f32(dstSize.x) * xRange;\n  let Y = params.bounds.y + (f32(gid.y) + 0.5) / f32(dstSize.y) * yRange;\n  let p = params.matrix * vec3<f32>(X, Y, 1.0);\n  let sx = p.x / p.z;\n  let sy = p.y / p.z;\n  if (sx >= 0.0 && sy >= 0.0 && sx < f32(srcSize.x) && sy < f32(srcSize.y)) {\n    let uv = vec2<f32>(sx, sy) / vec2<f32>(f32(srcSize.x), f32(srcSize.y));\n    color = textureSampleLevel(srcTex, samp, uv, 0.0);\n  }`;
    const machineToCam = `let p = params.matrix * vec3<f32>(f32(gid.x) + 0.5, f32(gid.y) + 0.5, 1.0);\n  let X = p.x / p.z;\n  let Y = p.y / p.z;\n  let mx = (X - params.bounds.x) / (params.bounds.z - params.bounds.x);\n  let my = (Y - params.bounds.y) / (params.bounds.w - params.bounds.y);\n  let sx = mx * f32(srcSize.x);\n  let sy = my * f32(srcSize.y);\n  if (sx >= 0.0 && sy >= 0.0 && sx < f32(srcSize.x) && sy < f32(srcSize.y)) {\n    let uv = vec2<f32>(sx, sy) / vec2<f32>(f32(srcSize.x), f32(srcSize.y));\n    color = textureSampleLevel(srcTex, samp, uv, 0.0);\n  }`;
    const body = direction === 'camToMachine' ? camToMachine : machineToCam;
    return `${common}\n\n@compute @workgroup_size(8,8)\nfn main(@builtin(global_invocation_id) gid: vec3<u32>) {\n  let dstSize = textureDimensions(dstTex);\n  if (gid.x >= dstSize.x || gid.y >= dstSize.y) { return; }\n  let srcSize = textureDimensions(srcTex);\n  var color : vec4<f32> = vec4f(0.0,0.0,0.0,1.0);\n  ${body}\n  textureStore(dstTex, vec2<i32>(i32(gid.x), i32(gid.y)), color);\n}`;
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
