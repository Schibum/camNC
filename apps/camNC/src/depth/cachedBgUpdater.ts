import { makeShaderDataDefinitions, makeStructuredView } from 'webgpu-utils';
import { DepthOutput } from './depthPipeline';
import { RemapStepParams } from './remapPipeline';
import { REMAP_PARAMS_STRUCT, UNDISTORT_WGSL } from './sharedShaders';
import { rawImageToGPUTexture } from './textureConverters';
import { createRemapUniform } from './webgpu-helpers';

export class CachedBgUpdater {
  // Lazy-initialised compute pipeline that combines depth map + colour image using a threshold.
  private maskPipeline: GPUComputePipeline | null = null;
  private maskSampler: GPUSampler | null = null;

  private shaderCode = `
${REMAP_PARAMS_STRUCT}

${UNDISTORT_WGSL}

@group(0) @binding(0) var colorTex : texture_2d<f32>;
@group(0) @binding(1) var depthTex : texture_2d<f32>;
@group(0) @binding(2) var samp      : sampler;
@group(0) @binding(3) var<uniform> params : RemapParams;
@group(0) @binding(4) var<uniform> threshold : f32;
@group(0) @binding(5) var dstTex  : texture_storage_2d<rgba8unorm, write>;

@compute @workgroup_size(8,8)
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
  let size = textureDimensions(dstTex);
  if (gid.x >= size.x || gid.y >= size.y) { return; }

  let uv = (vec2<f32>(vec2<u32>(gid.xy)) + vec2<f32>(0.5,0.5)) / vec2<f32>(vec2<u32>(size));
  let depth   = textureSampleLevel(depthTex, samp, uv, 0.0).r;
  var outCol : vec4<f32> = vec4<f32>(0.0,0.0,0.0,1.0);
  if (depth <= threshold) {
    outCol = textureSampleLevel(colorTex, samp, uv, 0.0);
  }
  textureStore(dstTex, vec2<i32>(i32(gid.x), i32(gid.y)), outCol);
}`;

  constructor(
    private device: GPUDevice,
    private params: RemapStepParams
  ) {}

  /** Returns (and lazily creates) the compute pipeline that applies the binary mask. */
  private getMaskPipeline(): GPUComputePipeline {
    if (this.maskPipeline) return this.maskPipeline;

    const shader = this.device.createShaderModule({ code: this.shaderCode });

    this.maskPipeline = this.device.createComputePipeline({
      layout: 'auto',
      compute: { module: shader, entryPoint: 'main' },
    });

    this.maskSampler = this.device.createSampler();
    return this.maskPipeline;
  }

  async update(frame: GPUTexture, { depth, threshold }: DepthOutput) {
    const depthTex = await rawImageToGPUTexture(this.device, depth);
    depthTex.label = 'CachedBgUpdater depth texture';

    const outWidth = frame.width;
    const outHeight = frame.height;
    const dst = this.device.createTexture({
      label: 'CachedBgUpdater output texture',
      size: [outWidth, outHeight],
      format: 'rgba8unorm',
      usage:
        GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC | GPUTextureUsage.RENDER_ATTACHMENT,
    });

    const defs = makeShaderDataDefinitions(this.shaderCode);
    const paramsValues = makeStructuredView(defs.uniforms.params);

    createRemapUniform(this.params, paramsValues);
    const remapUniformBuffer = this.device.createBuffer({
      label: 'CachedBgUpdater remapParams uniform buffer',
      size: paramsValues.arrayBuffer.byteLength,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(remapUniformBuffer, 0, paramsValues.arrayBuffer);

    const thresholdValues = makeStructuredView(defs.uniforms.threshold);
    console.log('thresholdValues', thresholdValues);
    thresholdValues.set(threshold);
    console.log('thresholdValues', thresholdValues.arrayBuffer);

    const thresholdUniformBuffer = this.device.createBuffer({
      label: 'CachedBgUpdater threshold uniform buffer',
      size: thresholdValues.arrayBuffer.byteLength,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(thresholdUniformBuffer, 0, thresholdValues.arrayBuffer);

    const pipeline = this.getMaskPipeline();
    const bindGroup = this.device.createBindGroup({
      label: 'CachedBgUpdater bind group',
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: frame.createView() }, // original colour image
        { binding: 1, resource: depthTex.createView() },
        { binding: 2, resource: this.maskSampler! },
        { binding: 3, resource: { buffer: remapUniformBuffer } },
        { binding: 4, resource: { buffer: thresholdUniformBuffer } },
        { binding: 5, resource: dst.createView() },
      ],
    });

    const encoder = this.device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(Math.ceil(outWidth / 8), Math.ceil(outHeight / 8));
    pass.end();
    this.device.queue.submit([encoder.finish()]);

    // Clean-up temporary GPU resources.
    depthTex.destroy();

    return dst;
  }
}
