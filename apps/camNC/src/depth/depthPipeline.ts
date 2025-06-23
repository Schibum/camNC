import { Pipeline, pipeline, RawImage } from '@huggingface/transformers';

import { gpuTextureToRawImage, rawImageToGPUTexture } from './textureConverters';

export interface DepthEstimationParams {
  outputSize: [number, number];
  /** Optional: number of histogram bins used to find peak depth. Defaults to 64. */
  histogramBins?: number;
  /** Optional: offset added (in the 0-1 depth domain) to the detected peak before thresholding. Defaults to 0.05. */
  thresholdOffset?: number;
}

/**
 * DepthEstimationStep performs monocular depth estimation on the RGBA texture produced by
 * previous GPU steps. Internally it:
 * 1. Reads the GPUTexture back to CPU memory (RGBA8).
 * 2. Converts that byte buffer into an ImageData / ImageBitmap that the transformers.js depth
 *    pipeline can consume.
 * 3. Runs the ONNX depth-anything model in transformers.js.
 * 4. Copies the resulting depth map back into a fresh GPUTexture (single channel encoded as
 *    normalized grayscale in RGBA8) so that subsequent GPU-based steps or the blitting logic can
 *    continue to work unchanged.
 */
export class DepthEstimationStep {
  private device: GPUDevice;
  private params: DepthEstimationParams;
  // Lazily initialised transformers.js pipeline
  private depthEstimatorPromise: Promise<Pipeline> | null = null;

  // Lazy-initialised compute pipeline that combines depth map + colour image using a threshold.
  private maskPipeline: GPUComputePipeline | null = null;
  private maskSampler: GPUSampler | null = null;

  constructor(device: GPUDevice, params: DepthEstimationParams) {
    this.device = device;
    this.params = params;
  }

  private getEstimator(): Promise<Pipeline> {
    if (!this.depthEstimatorPromise) {
      // Initialise once – use the lightweight small variant for better perf.
      this.depthEstimatorPromise = pipeline('depth-estimation', 'onnx-community/depth-anything-v2-small', {
        device: 'webgpu',
        dtype: 'fp16',
      }) as unknown as Promise<Pipeline>;
    }
    return this.depthEstimatorPromise!;
  }

  /** Returns (and lazily creates) the compute pipeline that applies the binary mask. */
  private getMaskPipeline(): GPUComputePipeline {
    if (this.maskPipeline) return this.maskPipeline;

    const shader = this.device.createShaderModule({
      code: `struct Params { threshold : f32, _pad0: vec3<f32> };

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

  async process(machineTexture: GPUTexture, colorTexture: GPUTexture): Promise<GPUTexture> {
    console.log('outSize', this.params.outputSize, 'textDim', machineTexture.width, machineTexture.height);

    // ==== Phase 1: GPUTexture -> RawImage (for depth estimator) ====
    const image = await gpuTextureToRawImage(this.device, machineTexture, machineTexture.width, machineTexture.height);

    const estimator = await this.getEstimator();
    const t0 = performance.now();
    const result = await estimator(image);
    console.log(`Depth estimation took ${performance.now() - t0}ms`);

    // depthOutput is single-channel, so pixel data length = width*height (Uint8 values 0-255)
    const depthOutput = result.depth as RawImage;
    console.log('depthOutput', depthOutput);

    // ==== Phase 2: Build histogram on CPU to find dominant depth ====
    const bins = this.params.histogramBins ?? 64;
    const binCounts = new Uint32Array(bins);
    // Access raw pixel buffer directly (single channel)
    const grayData = depthOutput.data as Uint8ClampedArray;
    for (let i = 0; i < grayData.length; i++) {
      const val = grayData[i]!; // 0-255
      const idx = Math.min(bins - 1, (val * bins) >> 8); // fast floor(val/256*bins)
      binCounts[idx]!++;
    }
    console.log('binCounts', binCounts);
    let peakIdx = 0;
    for (let i = 1; i < bins; i++) {
      if (binCounts[i]! > binCounts[peakIdx]!) peakIdx = i;
    }
    console.log('peakIdx', peakIdx);
    const offset = this.params.thresholdOffset ?? 0.05;
    let threshold = (peakIdx + 0.5) / bins + offset; // convert to 0-1 and add offset
    if (threshold > 1.0) threshold = 1.0;
    // threshold = 0;

    // ==== Phase 3: Copy depth map into GPUTexture ====
    const depthTex = await rawImageToGPUTexture(this.device, depthOutput);

    // ==== Phase 4: Apply binary mask using compute shader ====
    const outWidth = this.params.outputSize[0];
    const outHeight = this.params.outputSize[1];
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
        { binding: 0, resource: colorTexture.createView() }, // original colour image
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
