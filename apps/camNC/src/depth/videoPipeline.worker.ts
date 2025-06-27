import { ensureReadableStream, registerThreeJsTransferHandlers, ReplaceableStreamWorker } from '@wbcnc/video-worker-utils';
import * as Comlink from 'comlink';
import { CachedBgUpdater } from './cachedBgUpdater';
import { DepthEstimationStep } from './depthPipeline';
import { GaussianBlurStep } from './gaussianBlurStep';
import { MaskInflationStep } from './maskInflationStep';
import { CamToMachineStep, MachineToCamStep, RemapStepParams, UndistortParams, UndistortStep } from './remapPipeline';

export type Mode = 'undistort' | 'camToMachine' | 'machineToCam' | 'depth';
export type Config =
  | { mode: 'undistort'; params: UndistortParams }
  | { mode: 'camToMachine'; params: RemapStepParams }
  | { mode: 'machineToCam'; params: RemapStepParams }
  | { mode: 'depth'; params: RemapStepParams }
  | { mode: 'none' };

export interface VideoPipelineWorkerAPI extends ReplaceableStreamWorker {
  init(stream: ReadableStream<VideoFrame> | MediaStreamTrack, cfg: Config): Promise<void>;
  process(): Promise<ImageBitmap>;
}

/** Helper: run transform producing a new texture, destroy the old one, return new. */
async function replaceTex(current: GPUTexture, transform: (src: GPUTexture) => Promise<GPUTexture>): Promise<GPUTexture> {
  const next = await transform(current);
  current.destroy();
  return next;
}

class VideoPipelineWorker implements VideoPipelineWorkerAPI {
  private reader: ReadableStreamDefaultReader<VideoFrame> | null = null;
  private device: GPUDevice | null = null;
  private canvas: OffscreenCanvas | null = null;
  private ctx: GPUCanvasContext | null = null;
  private outWidth = 0;
  private outHeight = 0;
  private blitPipeline: GPURenderPipeline | null = null;
  private blitSampler: GPUSampler | null = null;
  private blitLayout: GPUBindGroupLayout | null = null;
  private cfg: Config | null = null;

  // Cached step instances to avoid per-frame pipeline creation
  private undistortStep?: UndistortStep;
  private camToMachineStep?: CamToMachineStep;
  private machineToCamStep?: MachineToCamStep;
  private depthPrepStep?: CamToMachineStep;
  private cachedBgUpdater?: CachedBgUpdater;
  private depthEstimator?: DepthEstimationStep;
  private maskInflationStep?: MaskInflationStep;
  private gaussianBlurStep?: GaussianBlurStep;
  private maskWarpStep?: MachineToCamStep;

  private cachedBg: GPUTexture | null = null;

  /** Utility to ensure GPU device is present */
  private ensureDevice(): GPUDevice {
    if (!this.device) throw new Error('GPU device not ready');
    return this.device;
  }

  /** Lazily create / return UndistortStep */
  private getUndistortStep(params: UndistortParams): UndistortStep {
    if (!this.undistortStep) {
      this.undistortStep = new UndistortStep(this.ensureDevice(), params);
    }
    return this.undistortStep;
  }

  /** Lazily create / return CamToMachineStep */
  private getCamToMachineStep(params: RemapStepParams): CamToMachineStep {
    if (!this.camToMachineStep) {
      this.camToMachineStep = new CamToMachineStep(this.ensureDevice(), params);
    }
    return this.camToMachineStep;
  }

  /** Lazily create / return MachineToCamStep */
  private getMachineToCamStep(params: RemapStepParams, scale?: [number, number]): MachineToCamStep {
    if (!this.machineToCamStep) {
      this.machineToCamStep = new MachineToCamStep(this.ensureDevice(), params, scale);
    }
    return this.machineToCamStep;
  }

  /** Lazily create / return depth preparatory CamToMachineStep (machine-space) */
  private getDepthPrepStep(params: RemapStepParams): CamToMachineStep {
    if (!this.depthPrepStep) {
      this.depthPrepStep = new CamToMachineStep(this.ensureDevice(), params);
    }
    return this.depthPrepStep;
  }

  /** Lazily create / return DepthEstimationStep */
  private getDepthEstimator(): DepthEstimationStep {
    if (!this.depthEstimator) {
      this.depthEstimator = new DepthEstimationStep(this.ensureDevice());
    }
    return this.depthEstimator;
  }

  /** Lazily create / return CachedBgUpdater */
  private getCachedBgUpdater(params: RemapStepParams): CachedBgUpdater {
    if (!this.cachedBgUpdater) {
      this.cachedBgUpdater = new CachedBgUpdater(this.ensureDevice(), params);
    }
    return this.cachedBgUpdater;
  }

  /** Lazily create / return MaskInflationStep */
  private getMaskInflationStep(): MaskInflationStep {
    if (!this.maskInflationStep) {
      this.maskInflationStep = new MaskInflationStep(this.ensureDevice());
    }
    return this.maskInflationStep;
  }

  /** Lazily create / return GaussianBlurStep */
  private getGaussianBlurStep(): GaussianBlurStep {
    if (!this.gaussianBlurStep) {
      this.gaussianBlurStep = new GaussianBlurStep(this.ensureDevice());
    }
    return this.gaussianBlurStep;
  }

  /** Lazily create / return mask warp step (Machine -> Cam) */
  private getMaskWarpStep(params: RemapStepParams, scale: [number, number]): MachineToCamStep {
    if (!this.maskWarpStep) {
      this.maskWarpStep = new MachineToCamStep(this.ensureDevice(), params, scale);
    }
    return this.maskWarpStep;
  }

  /* --- Mode specific processing helpers --- */
  private async runUndistort(tex: GPUTexture, params: UndistortParams): Promise<GPUTexture> {
    const step = this.getUndistortStep(params);
    return replaceTex(tex, t => step.process(t));
  }

  private async runCamToMachine(tex: GPUTexture, params: RemapStepParams): Promise<GPUTexture> {
    const step = this.getCamToMachineStep(params);
    return replaceTex(tex, t => step.process(t));
  }

  private async runMachineToCam(tex: GPUTexture, params: RemapStepParams): Promise<GPUTexture> {
    const camToMachine = this.getCamToMachineStep(params);
    const machineToCam = this.getMachineToCamStep(params);
    tex = await replaceTex(tex, t => camToMachine.process(t));
    return replaceTex(tex, t => machineToCam.process(t));
  }

  private async runDepth(tex: GPUTexture, params: RemapStepParams, width: number, height: number): Promise<GPUTexture> {
    const depthSize: [number, number] = [512, 512];
    const prepStep = this.getDepthPrepStep({
      ...params,
      outputSize: depthSize,
    });
    const depthEstimator = this.getDepthEstimator();
    const bgUpdater = this.getCachedBgUpdater(params);

    const maskDim = 512;
    const maskWarp = this.getMaskWarpStep({ ...params, outputSize: [maskDim, maskDim] }, [width / maskDim, height / maskDim]);
    const maskInflation = this.getMaskInflationStep();
    const gaussianBlur = this.getGaussianBlurStep();

    const machineTex = await prepStep.process(tex);
    const depthOutput = await depthEstimator.process(machineTex);

    let t0 = performance.now();
    const maskTex = await maskInflation.process(depthOutput);
    console.log('maskInflation', performance.now() - t0);

    // Warp blurred mask back to camera space
    t0 = performance.now();
    const camMaskTex = await maskWarp.process(maskTex);
    console.log('maskWarpStep', performance.now() - t0);
    maskTex.destroy();

    t0 = performance.now();
    const blurredMaskTex = await gaussianBlur.process(camMaskTex);
    console.log('gaussianBlur', performance.now() - t0);
    camMaskTex.destroy();

    t0 = performance.now();
    const updatedTex = await replaceTex(tex, t => bgUpdater.update(t, blurredMaskTex, this.cachedBg!));
    console.log('cachedBgUpdater', performance.now() - t0);
    blurredMaskTex.destroy();

    // Update cached background
    const copyEncoder = this.ensureDevice().createCommandEncoder();
    copyEncoder.copyTextureToTexture({ texture: updatedTex }, { texture: this.cachedBg! }, [updatedTex.width, updatedTex.height]);
    this.ensureDevice().queue.submit([copyEncoder.finish()]);

    return updatedTex;
  }

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

  async init(stream: ReadableStream<VideoFrame> | MediaStreamTrack, cfg: Config): Promise<void> {
    if (!navigator.gpu) throw new Error('WebGPU not supported');
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) throw new Error('No GPU adapter');
    this.device = await adapter.requestDevice();
    this.reader = ensureReadableStream(stream).getReader();

    this.cfg = cfg;

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
    if (!this.reader || !this.device || !this.cfg) throw new Error('Worker not initialized');
    const t0All = performance.now();
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
      label: 'srcTex',
      size: [width, height],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC | GPUTextureUsage.RENDER_ATTACHMENT,
    });
    this.device.queue.copyExternalImageToTexture({ source: frame }, { texture: srcTex }, [width, height]);

    if (!this.cachedBg && this.cfg.mode === 'depth') {
      // this.cachedBg = this.device.createTexture({
      //   size: [width, height],
      //   format: 'rgba8unorm',
      //   usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC | GPUTextureUsage.RENDER_ATTACHMENT,
      // });

      this.cachedBg = await this.getUndistortStep(this.cfg.params).process(srcTex);
      // Initialize cached background with the first frame
      // this.device.queue.copyExternalImageToTexture({ source: frame }, { texture: this.cachedBg }, [width, height]);
    }
    frame.close();

    let tex = srcTex;
    try {
      if (this.cfg.mode === 'undistort') {
        tex = await this.runUndistort(tex, this.cfg.params);
      } else if (this.cfg.mode === 'camToMachine') {
        tex = await this.runCamToMachine(tex, this.cfg.params);
      } else if (this.cfg.mode === 'machineToCam') {
        tex = await this.runMachineToCam(tex, this.cfg.params);
      } else if (this.cfg.mode === 'depth') {
        tex = await this.runDepth(tex, this.cfg.params, width, height);
      } else if (this.cfg.mode === 'none') {
        // No processing needed
      }
    } catch (e) {
      console.error('Error in processing:', e);
      throw new Error('Error in processing');
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
    console.log('total time', performance.now() - t0All);
    return bitmap;
  }
}

registerThreeJsTransferHandlers();
const worker = new VideoPipelineWorker();
Comlink.expose(worker);

(self as any).onerror = (e: ErrorEvent) => console.error('[VideoPipelineWorker] uncaught:', e);
