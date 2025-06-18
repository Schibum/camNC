import { Pipeline, pipeline, RawImage } from '@huggingface/transformers';

import type { WebGPUPipelineStep } from './remapPipeline';
import { gpuTextureToRawImage, rawImageToGPUTexture } from './textureConverters';

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

    // ==== Phase 1: GPUTexture -> RawImage ====
    const image = await gpuTextureToRawImage(this.device, texture, width, height);

    const estimator = await this.getEstimator();
    let startTime = performance.now();
    const result = await estimator(image);
    let endTime = performance.now();
    console.log(`Depth estimation took ${endTime - startTime}ms`);

    console.log('result', result);
    const depthOutput = result.depth as RawImage;

    const dst = await rawImageToGPUTexture(this.device, depthOutput);

    return dst;
  }
}
