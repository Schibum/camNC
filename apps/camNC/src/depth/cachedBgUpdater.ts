import { makeShaderDataDefinitions, makeStructuredView } from 'webgpu-utils';
import { RemapStepParams } from './remapPipeline';
import { REMAP_PARAMS_STRUCT, UNDISTORT_WGSL } from './sharedShaders';
import { createRemapUniform, generateMachineToCamMatrix } from './webgpu-helpers';

export class CachedBgUpdater {
  // Lazy-initialised compute pipeline that combines depth map + colour image using a threshold.
  private maskPipeline: GPUComputePipeline | null = null;
  private maskSampler: GPUSampler | null = null;

  private shaderCode = /* wgsl */ `
  // Binary mask updater: combines original colour image with cached background using a pre-computed mask.

  ${REMAP_PARAMS_STRUCT}

  ${UNDISTORT_WGSL}

  @group(0) @binding(0) var colorTex : texture_2d<f32>;
  @group(0) @binding(1) var maskTex  : texture_2d<f32>; // 1.0 = foreground, 0.0 = background
  @group(0) @binding(2) var samp      : sampler;
  @group(0) @binding(3) var<uniform> params : RemapParams;
  @group(0) @binding(4) var cachedBgTex: texture_2d<f32>;
  @group(0) @binding(5) var dstTex  : texture_storage_2d<rgba8unorm, write>;

  @compute @workgroup_size(8,8)
  fn main(@builtin(global_invocation_id) gid : vec3<u32>) {

    let size = textureDimensions(dstTex);
    if (gid.x >= size.x || gid.y >= size.y) { return; }

    let uv = (vec2<f32>(vec2<u32>(gid.xy)) + vec2<f32>(0.5,0.5)) / vec2<f32>(vec2<u32>(size));

    var outCol : vec4<f32> = vec4<f32>(0.0,0.0,0.0,1.0);
    let srcPos = undistort_uv(f32(gid.x), f32(gid.y));
    if (srcPos.x >= 0.0 && srcPos.y >= 0.0 && srcPos.x < f32(size.x) && srcPos.y < f32(size.y)) {

      let uvUndist = vec2<f32>(srcPos.x, srcPos.y) / vec2<f32>(f32(size.x), f32(size.y));
      let maskVal = textureSampleLevel(maskTex, samp, uv, 0.0).r;

      outCol = maskVal * textureSampleLevel(colorTex, samp, uvUndist, 0.0) + (1.0 - maskVal) * textureSampleLevel(cachedBgTex, samp, uv, 0.0);
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

    this.maskSampler = this.device.createSampler({
      label: 'CachedBgUpdater sampler',
      magFilter: 'linear',
      minFilter: 'linear',
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge',
    });
    return this.maskPipeline;
  }

  async update(frame: GPUTexture, maskTex: GPUTexture, cachedBg: GPUTexture) {
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

    createRemapUniform({ ...this.params, combinedProjectionMatrix: generateMachineToCamMatrix(this.params) }, paramsValues);
    const remapUniformBuffer = this.device.createBuffer({
      label: 'CachedBgUpdater remapParams uniform buffer',
      size: paramsValues.arrayBuffer.byteLength,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(remapUniformBuffer, 0, paramsValues.arrayBuffer);

    const pipeline = this.getMaskPipeline();
    const bindGroup = this.device.createBindGroup({
      label: 'CachedBgUpdater bind group',
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: frame.createView() }, // original colour image
        { binding: 1, resource: maskTex.createView() },
        { binding: 2, resource: this.maskSampler! },
        { binding: 3, resource: { buffer: remapUniformBuffer } },
        { binding: 4, resource: cachedBg.createView() },
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

    remapUniformBuffer.destroy();

    return dst;
  }
}
