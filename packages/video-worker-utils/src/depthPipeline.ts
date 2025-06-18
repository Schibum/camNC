import { Pipeline, pipeline, RawImage } from '@huggingface/transformers';

import type { WebGPUPipelineStep } from './remapPipeline';

export interface DepthEstimationParams {
  outputSize: [number, number];
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
export class DepthEstimationStep implements WebGPUPipelineStep {
  private device: GPUDevice;
  private params: DepthEstimationParams;
  // Lazily initialised transformers.js pipeline
  private depthEstimatorPromise: Promise<Pipeline> | null = null;

  constructor(device: GPUDevice, params: DepthEstimationParams) {
    this.device = device;
    this.params = params;
  }

  private getEstimator(): Promise<Pipeline> {
    if (!this.depthEstimatorPromise) {
      // Initialise once – use the lightweight small variant for better perf.
      this.depthEstimatorPromise = pipeline('depth-estimation', 'onnx-community/depth-anything-v2-small', {
        device: 'webgpu',
      }) as unknown as Promise<Pipeline>;
    }
    return this.depthEstimatorPromise!;
  }

  async process(texture: GPUTexture): Promise<GPUTexture> {
    const [width, height] = this.params.outputSize;

    // ==== Phase 1: read GPUTexture back to CPU RGBA buffer ====
    const bytesPerPixel = 4; // rgba8unorm
    const bytesPerRow = Math.ceil((width * bytesPerPixel) / 256) * 256; // WebGPU alignment requirement
    const bufferSize = bytesPerRow * height;

    const readBuffer = this.device.createBuffer({
      size: bufferSize,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });

    const commandEncoder = this.device.createCommandEncoder();
    commandEncoder.copyTextureToBuffer(
      { texture },
      { buffer: readBuffer, bytesPerRow, rowsPerImage: height },
      { width, height, depthOrArrayLayers: 1 }
    );
    this.device.queue.submit([commandEncoder.finish()]);

    await readBuffer.mapAsync(GPUMapMode.READ);
    const mapped = new Uint8Array(readBuffer.getMappedRange());

    // Because we had to pad each row to the 256-byte alignment, we need to repack to tight rows
    const packed = new Uint8ClampedArray(width * height * bytesPerPixel);
    for (let y = 0; y < height; y++) {
      const srcStart = y * bytesPerRow;
      const dstStart = y * width * bytesPerPixel;
      packed.set(mapped.subarray(srcStart, srcStart + width * bytesPerPixel), dstStart);
    }
    readBuffer.unmap();
    readBuffer.destroy();

    const image = new RawImage(packed, width, height, 4);

    const estimator = await this.getEstimator();
    let startTime = performance.now();
    const result = await estimator(image);
    let endTime = performance.now();
    console.log(`Depth estimation took ${endTime - startTime}ms`);

    console.log('result', result);
    const depthOutput = (result.depth || result.predicted_depth) as RawImage;

    // Convert RawImage to ImageData and then to ImageBitmap
    const rgbaDepth = depthOutput.rgba();

    const depthImageData = new ImageData(new Uint8ClampedArray(rgbaDepth.data), rgbaDepth.width, rgbaDepth.height);
    const depthBitmap = await createImageBitmap(depthImageData);

    // ==== Phase 4: copy depth bitmap back to GPU texture ====
    const dst = this.device.createTexture({
      size: [depthBitmap.width, depthBitmap.height],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
    });

    this.device.queue.copyExternalImageToTexture({ source: depthBitmap }, { texture: dst }, [depthBitmap.width, depthBitmap.height]);

    depthBitmap.close();

    return dst;
  }
}
