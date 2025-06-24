import { DepthOutput } from './depthPipeline';
import { RemapStepParams } from './remapPipeline';
import { UNDISTORT_WGSL } from './sharedShaders';
import { rawImageToGPUTexture } from './textureConverters';

export class CachedBgUpdater {
  // Lazy-initialised compute pipeline that combines depth map + colour image using a threshold.
  private maskPipeline: GPUComputePipeline | null = null;
  private maskSampler: GPUSampler | null = null;

  constructor(
    private device: GPUDevice,
    private params: RemapStepParams
  ) {}

  /** Returns (and lazily creates) the compute pipeline that applies the binary mask. */
  private getMaskPipeline(): GPUComputePipeline {
    if (this.maskPipeline) return this.maskPipeline;

    const shader = this.device.createShaderModule({
      code: `
struct Params {
  threshold : f32,
  // cam→machine part
  matrix : mat3x3<f32>,
  bounds : vec4<f32>,

  // undistort part (mirrors UndistortStep)
  cameraMatrix : mat3x3<f32>,
  newCameraMatrix : mat3x3<f32>,
  distCoeffs : vec4<f32>,
  k3 : f32,
};

${UNDISTORT_WGSL}

@group(0) @binding(0) var colorTex : texture_2d<f32>;
@group(0) @binding(1) var depthTex : texture_2d<f32>;
@group(0) @binding(2) var samp      : sampler;
@group(0) @binding(3) var<uniform> params : Params;
@group(0) @binding(4) var dstTex  : texture_storage_2d<rgba8unorm, write>;

@compute @workgroup_size(8,8)
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
  let size = textureDimensions(dstTex);
  if (gid.x >= size.x || gid.y >= size.y) { return; }

  let uv = (vec2<f32>(vec2<u32>(gid.xy)) + vec2<f32>(0.5,0.5)) / vec2<f32>(vec2<u32>(size));
  let depth   = textureSampleLevel(depthTex, samp, uv, 0.0).r;
  var outCol : vec4<f32> = vec4<f32>(0.0,0.0,0.0,1.0);
  if (depth <= params.threshold) {
    outCol = textureSampleLevel(colorTex, samp, uv, 0.0);
  }
  textureStore(dstTex, vec2<i32>(i32(gid.x), i32(gid.y)), outCol);
}`,
    });

    this.maskPipeline = this.device.createComputePipeline({
      layout: 'auto',
      compute: { module: shader, entryPoint: 'main' },
    });

    this.maskSampler = this.device.createSampler();
    return this.maskPipeline;
  }

  async update(frame: GPUTexture, { depth, threshold }: DepthOutput) {
    const depthTex = await rawImageToGPUTexture(this.device, depth);

    const outWidth = frame.width;
    const outHeight = frame.height;
    const dst = this.device.createTexture({
      size: [outWidth, outHeight],
      format: 'rgba8unorm',
      usage:
        GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC | GPUTextureUsage.RENDER_ATTACHMENT,
    });

    const pipeline = this.getMaskPipeline();
    const uniformData = new Float32Array(8);
    uniformData[0] = threshold; // remaining entries stay 0

    const uniformBuffer = this.device.createBuffer({
      size: uniformData.byteLength, // 32 bytes meets min binding size
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      mappedAtCreation: true,
    });
    new Float32Array(uniformBuffer.getMappedRange()).set(uniformData);
    uniformBuffer.unmap();

    const bindGroup = this.device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: frame.createView() }, // original colour image
        { binding: 1, resource: depthTex.createView() },
        { binding: 2, resource: this.maskSampler! },
        { binding: 3, resource: { buffer: uniformBuffer } },
        { binding: 4, resource: dst.createView() },
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
