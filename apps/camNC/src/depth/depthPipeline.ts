import { Pipeline, pipeline, RawImage } from '@huggingface/transformers';

import { gpuTextureToRawImage } from './textureConverters';

export interface DepthEstimationParams {
  /** Optional: number of histogram bins used to find peak depth. Defaults to 64. */
  histogramBins?: number;
  /** Optional: offset added (in the 0-1 depth domain) to the detected peak before thresholding. Defaults to 0.05. */
  thresholdOffset?: number;
}

export interface DepthOutput {
  depth: RawImage;
  threshold: number;
  flatDepthMin: number;
  flatDepthMax: number;
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

  constructor(device: GPUDevice, params: DepthEstimationParams = {}) {
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

  async process(machineTexture: GPUTexture): Promise<DepthOutput> {
    console.log('textDim', machineTexture.width, machineTexture.height);

    // ==== Phase 1: GPUTexture -> RawImage (for depth estimator) ====
    let t0 = performance.now();
    const image = await gpuTextureToRawImage(this.device, machineTexture, machineTexture.width, machineTexture.height);
    console.log('gpuTextureToRawImage', performance.now() - t0);

    t0 = performance.now();
    const estimator = await this.getEstimator();
    console.log('getEstimator', performance.now() - t0);

    t0 = performance.now();
    const result = await estimator(image);
    console.log(`Depth estimation took ${performance.now() - t0}ms`);

    t0 = performance.now();
    // Note: histogram logic could be done on the GPU, but just takes ~2ms on CPU anyway.
    // depthOutput is single-channel, so pixel data length = width*height (Uint8 values 0-255)
    const depthOutput = result.depth as RawImage;
    // console.log('depthOutput', depthOutput);

    // ==== Phase 2: Build histogram on CPU to find dominant depth ====
    const bins = this.params.histogramBins ?? 10;
    const binCounts = new Uint32Array(bins);
    // Access raw pixel buffer directly (single channel)
    const grayData = depthOutput.data as Uint8ClampedArray;
    for (let i = 0; i < grayData.length; i++) {
      const val = grayData[i]!; // 0-255
      const idx = Math.min(bins - 1, (val * bins) >> 8); // fast floor(val/256*bins)
      binCounts[idx]!++;
    }
    // console.log('binCounts', binCounts);
    let peakIdx = 0;
    for (let i = 1; i < bins; i++) {
      if (binCounts[i]! > binCounts[peakIdx]!) peakIdx = i;
    }
    console.log('bins', binCounts, 'peakIdx', peakIdx);
    // console.log('peakIdx', peakIdx);
    const binSize = 1.0 / bins;
    const offset = this.params.thresholdOffset ?? 2 * binSize;
    const flatDepth = (peakIdx + 0.5) / bins;
    let threshold = flatDepth + offset; // convert to 0-1 and add offset
    if (threshold > 1.0) threshold = 1.0;
    // threshold = 0;
    console.log('finding threshold took', performance.now() - t0);

    return {
      depth: depthOutput,
      flatDepthMin: flatDepth - binSize / 2,
      flatDepthMax: flatDepth + binSize / 2,
      threshold,
    };
  }
}
