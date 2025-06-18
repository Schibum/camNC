import * as Comlink from 'comlink';
import { ensureReadableStream } from './ensureReadableStream';
import type { ReplaceableStreamWorker } from './videoStreamUtils';
import {
  CamToMachineStep,
  MachineToCamStep,
  UndistortStep,
  type RemapStepParams,
  type UndistortParams,
  type WebGPUPipelineStep,
} from './remapPipeline';

export interface StepConfig {
  type: 'undistort' | 'camToMachine' | 'machineToCam';
  params: any;
}

export interface VideoPipelineWorkerAPI extends ReplaceableStreamWorker {
  init(stream: ReadableStream<VideoFrame> | MediaStreamTrack, steps: StepConfig[]): Promise<void>;
  process(): Promise<ImageBitmap>;
}

class VideoPipelineWorker implements VideoPipelineWorkerAPI {
  private reader: ReadableStreamDefaultReader<VideoFrame> | null = null;
  private device: GPUDevice | null = null;
  private steps: WebGPUPipelineStep[] = [];
  private canvas: OffscreenCanvas | null = null;
  private ctx: GPUCanvasContext | null = null;
  private outWidth = 0;
  private outHeight = 0;

  async init(stream: ReadableStream<VideoFrame> | MediaStreamTrack, steps: StepConfig[]): Promise<void> {
    if (!navigator.gpu) throw new Error('WebGPU not supported');
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) throw new Error('No GPU adapter');
    this.device = await adapter.requestDevice();
    this.reader = ensureReadableStream(stream).getReader();

    this.steps = steps.map(cfg => {
      switch (cfg.type) {
        case 'camToMachine':
          this.outWidth = (cfg.params as RemapStepParams).outputSize[0];
          this.outHeight = (cfg.params as RemapStepParams).outputSize[1];
          return new CamToMachineStep(this.device!, cfg.params as RemapStepParams);
        case 'machineToCam':
          this.outWidth = (cfg.params as RemapStepParams).outputSize[0];
          this.outHeight = (cfg.params as RemapStepParams).outputSize[1];
          return new MachineToCamStep(this.device!, cfg.params as RemapStepParams);
        case 'undistort':
          this.outWidth = (cfg.params as UndistortParams).outputSize[0];
          this.outHeight = (cfg.params as UndistortParams).outputSize[1];
          return new UndistortStep(this.device!, cfg.params as UndistortParams);
        default:
          throw new Error('Unknown step type');
      }
    });

    this.canvas = new OffscreenCanvas(this.outWidth, this.outHeight);
    this.ctx = this.canvas.getContext('webgpu');
    if (!this.ctx) throw new Error('Failed to get WebGPU context');
    const format = navigator.gpu.getPreferredCanvasFormat();
    this.ctx.configure({ device: this.device, format, alphaMode: 'opaque' });
  }

  async replaceStream(stream: ReadableStream<VideoFrame> | MediaStreamTrack): Promise<void> {
    if (this.reader) {
      try {
        await this.reader.cancel();
      } catch {
        /* ignore */
      }
    }
    this.reader = ensureReadableStream(stream).getReader();
  }

  async process(): Promise<ImageBitmap> {
    if (!this.reader || !this.device || !this.ctx) throw new Error('Worker not initialized');
    const { value: frame, done } = await this.reader.read();
    if (done || !frame) throw new Error('Stream ended');
    const width = frame.displayWidth || frame.codedWidth;
    const height = frame.displayHeight || frame.codedHeight;

    const srcTex = this.device.createTexture({
      size: [width, height],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    this.device.queue.copyExternalImageToTexture({ source: frame }, { texture: srcTex }, [width, height]);
    frame.close();

    let tex = srcTex;
    for (const step of this.steps) {
      const next = await step.process(tex);
      tex.destroy();
      tex = next;
    }

    const encoder = this.device.createCommandEncoder();
    encoder.copyTextureToTexture({ texture: tex }, { texture: this.ctx.getCurrentTexture() }, [this.outWidth, this.outHeight]);
    this.device.queue.submit([encoder.finish()]);
    const bitmap = await this.canvas!.transferToImageBitmap();
    tex.destroy();
    return bitmap;
  }
}

const worker = new VideoPipelineWorker();
Comlink.expose(worker);

(self as any).onerror = (e: ErrorEvent) => console.error('[VideoPipelineWorker] uncaught:', e);
