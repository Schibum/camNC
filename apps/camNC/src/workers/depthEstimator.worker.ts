import * as Comlink from 'comlink';
import { AutoModel, AutoImageProcessor, RawImage } from '@huggingface/transformers';

export interface DepthResult {
  data: Float32Array;
  dims: [number, number];
}

export interface DepthEstimatorWorkerAPI {
  estimate(image: ImageData): Promise<DepthResult>;
}

class DepthEstimatorWorker implements DepthEstimatorWorkerAPI {
  private model: any | null = null;
  private processor: any | null = null;

  async init() {
    if (this.model) return;
    const modelId = 'onnx-community/depth-anything-v2-small';
    this.model = await AutoModel.from_pretrained(modelId, { device: 'webgpu' });
    this.processor = await AutoImageProcessor.from_pretrained(modelId, {});
  }

  async estimate(image: ImageData): Promise<DepthResult> {
    await this.init();
    const raw = new RawImage(image.data, image.width, image.height, 4);
    const inputs = await this.processor(raw as any);
    const { predicted_depth } = await this.model(inputs);
    const data = predicted_depth.data as Float32Array;
    const [, h, w] = predicted_depth.dims as [number, number, number];
    return { data, dims: [w, h] };
  }
}

Comlink.expose(new DepthEstimatorWorker());
