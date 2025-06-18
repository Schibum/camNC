import * as Comlink from 'comlink';
import { ensureReadableStream } from './ensureReadableStream';
import {
  CamToMachineStep,
  MachineToCamStep,
  UndistortStep,
  type RemapStepParams,
  type UndistortParams,
  type WebGPUPipelineStep,
} from './remapPipeline';
import type { ReplaceableStreamWorker } from './videoStreamUtils';

export type StepConfig =
  | { type: 'undistort'; params: UndistortParams }
  | { type: 'camToMachine'; params: RemapStepParams }
  | { type: 'machineToCam'; params: RemapStepParams };

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
  private blitPipeline: GPURenderPipeline | null = null;
  private blitSampler: GPUSampler | null = null;
  private blitLayout: GPUBindGroupLayout | null = null;

  // Helper to create or reconfigure the canvas once we know the target size
  private setupCanvas(width: number, height: number) {
    if (!this.device) throw new Error('GPU device not ready');
    this.canvas = new OffscreenCanvas(width, height);
    this.ctx = this.canvas.getContext('webgpu');
    if (!this.ctx) throw new Error('Failed to get WebGPU context');
    const format: GPUTextureFormat = 'rgba8unorm';
    this.ctx.configure({
      device: this.device,
      format,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_DST,
      alphaMode: 'opaque',
    });

    // Blit pipeline only needs to be created once (depends on format).
    if (!this.blitPipeline) {
      const shader = this.device.createShaderModule({
        code: `@group(0) @binding(0) var srcTex: texture_2d<f32>;
@group(0) @binding(1) var samp: sampler;

struct VOut { @builtin(position) pos: vec4<f32>, @location(0) uv: vec2<f32>, };

@vertex fn vs_main(@builtin(vertex_index) vid: u32) -> VOut {
  var positions = array<vec2<f32>, 6>(
    vec2<f32>(-1.0, -1.0), vec2<f32>( 1.0, -1.0), vec2<f32>(-1.0,  1.0),
    vec2<f32>(-1.0,  1.0), vec2<f32>( 1.0, -1.0), vec2<f32>( 1.0,  1.0),
  );
  var uvs = array<vec2<f32>, 6>(
    vec2<f32>(0.0, 1.0), vec2<f32>(1.0, 1.0), vec2<f32>(0.0, 0.0),
    vec2<f32>(0.0, 0.0), vec2<f32>(1.0, 1.0), vec2<f32>(1.0, 0.0),
  );
  var out: VOut; out.pos = vec4<f32>(positions[vid], 0.0, 1.0); out.uv = uvs[vid]; return out;
}

@fragment fn fs_main(in: VOut) -> @location(0) vec4<f32> { return textureSample(srcTex, samp, in.uv); }`,
      });
      this.blitPipeline = this.device.createRenderPipeline({
        layout: 'auto',
        vertex: { module: shader, entryPoint: 'vs_main' },
        fragment: { module: shader, entryPoint: 'fs_main', targets: [{ format }] },
        primitive: { topology: 'triangle-list' },
      });
      this.blitLayout = this.blitPipeline.getBindGroupLayout(0);
      this.blitSampler = this.device.createSampler();
    }
  }

  async init(stream: ReadableStream<VideoFrame> | MediaStreamTrack, steps: StepConfig[]): Promise<void> {
    if (!navigator.gpu) throw new Error('WebGPU not supported');
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) throw new Error('No GPU adapter');
    this.device = await adapter.requestDevice();
    this.reader = ensureReadableStream(stream).getReader();

    this.steps = steps.map(cfg => {
      switch (cfg.type) {
        case 'camToMachine':
          this.outWidth = cfg.params.outputSize[0];
          this.outHeight = cfg.params.outputSize[1];
          return new CamToMachineStep(this.device!, cfg.params);
        case 'machineToCam':
          this.outWidth = cfg.params.outputSize[0];
          this.outHeight = cfg.params.outputSize[1];
          return new MachineToCamStep(this.device!, cfg.params);
        case 'undistort':
          this.outWidth = cfg.params.outputSize[0];
          this.outHeight = cfg.params.outputSize[1];
          return new UndistortStep(this.device!, cfg.params);
        default:
          throw new Error('Unknown step type');
      }
    });

    // Only set up the canvas now if we already know the output dimensions (i.e., steps not empty).
    if (this.outWidth > 0 && this.outHeight > 0) {
      this.setupCanvas(this.outWidth, this.outHeight);
    }
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
    if (!this.reader || !this.device) throw new Error('Worker not initialized');
    const { value: frame, done } = await this.reader.read();
    if (done || !frame) throw new Error('Stream ended');
    const width = frame.displayWidth || frame.codedWidth;
    const height = frame.displayHeight || frame.codedHeight;

    // Lazily create the canvas & blit pipeline once we know frame size (for raw pass-through).
    if (!this.ctx) {
      this.outWidth = width;
      this.outHeight = height;
      this.setupCanvas(width, height);
    }

    const srcTex = this.device.createTexture({
      size: [width, height],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC | GPUTextureUsage.RENDER_ATTACHMENT,
    });
    this.device.queue.copyExternalImageToTexture({ source: frame }, { texture: srcTex }, [width, height]);
    frame.close();

    let tex = srcTex;
    for (const step of this.steps) {
      const next = await step.process(tex);
      tex.destroy();
      tex = next;
    }

    // Render pass blit: sample the final texture and draw onto the canvas swap texture.
    const encoder = this.device.createCommandEncoder();
    const view = this.ctx!.getCurrentTexture().createView();
    const bindGroup = this.device.createBindGroup({
      layout: this.blitLayout!,
      entries: [
        { binding: 0, resource: tex.createView() },
        { binding: 1, resource: this.blitSampler! },
      ],
    });

    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view,
          loadOp: 'clear',
          storeOp: 'store',
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
        },
      ],
    });
    pass.setPipeline(this.blitPipeline!);
    pass.setBindGroup(0, bindGroup);
    pass.draw(6);
    pass.end();

    this.device.queue.submit([encoder.finish()]);
    const bitmap = await this.canvas!.transferToImageBitmap();
    tex.destroy();
    return bitmap;
  }
}

const worker = new VideoPipelineWorker();
Comlink.expose(worker);

(self as any).onerror = (e: ErrorEvent) => console.error('[VideoPipelineWorker] uncaught:', e);
