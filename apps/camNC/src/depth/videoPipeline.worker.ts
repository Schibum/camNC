import { ensureReadableStream, registerThreeJsTransferHandlers, ReplaceableStreamWorker } from '@wbcnc/video-worker-utils';
import * as Comlink from 'comlink';
import log from 'loglevel';
import { CachedBgUpdater } from './cachedBgUpdater';
import { DepthEstimationStep } from './depthPipeline';
import { GaussianBlurStep } from './gaussianBlurStep';
import { MaskInflationStep } from './maskInflationStep';
import { CamToMachineStep, MachineToCamStep, RemapStepParams, UndistortParams, UndistortStep } from './remapPipeline';
import { TextureBlitter } from './textureBlitter';

// Number of pixels by which the mask used to compute the cached background should be inflated.
const kBgUpdateMaskMargin = 50;
// Number of pixels by which the mask used to render the final output should be inflated.
const kRenderMaskMargin = 5;

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
  private blitter: TextureBlitter | null = null;
  private cfg: Config | null = null;

  // Throttle processing to this frame rate.
  private frameRateLimit = 30;
  private lastFrameTime = 0;

  // Cached step instances to avoid per-frame pipeline creation
  private undistortStep?: UndistortStep;
  private camToMachineStep?: CamToMachineStep;
  private machineToCamStep?: MachineToCamStep;
  private depthPrepStep?: CamToMachineStep;
  private cachedBgUpdater?: CachedBgUpdater;
  private depthEstimator?: DepthEstimationStep;
  private bgMaskInflationStep?: MaskInflationStep;
  private renderMaskInflationStep?: MaskInflationStep;
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

  private getCachedBgUpdater(params: RemapStepParams): CachedBgUpdater {
    if (!this.cachedBgUpdater) {
      this.cachedBgUpdater = new CachedBgUpdater(this.ensureDevice(), params);
    }
    return this.cachedBgUpdater;
  }

  private getBgMaskInflationStep(): MaskInflationStep {
    if (!this.bgMaskInflationStep) {
      this.bgMaskInflationStep = new MaskInflationStep(this.ensureDevice(), kBgUpdateMaskMargin);
    }
    return this.bgMaskInflationStep;
  }

  private getRenderMaskInflationStep(): MaskInflationStep {
    if (!this.renderMaskInflationStep) {
      this.renderMaskInflationStep = new MaskInflationStep(this.ensureDevice(), kRenderMaskMargin);
    }
    return this.renderMaskInflationStep;
  }

  private getGaussianBlurStep(): GaussianBlurStep {
    if (!this.gaussianBlurStep) {
      this.gaussianBlurStep = new GaussianBlurStep(this.ensureDevice());
    }
    return this.gaussianBlurStep;
  }

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
    // Matches size and multiple requirement of
    // https://huggingface.co/depth-anything/Depth-Anything-V2-Small-hf/blob/main/preprocessor_config.json
    const scale = Math.max(width / 518, height / 518);
    const depthSize: [number, number] = [Math.ceil(width / scale / 14) * 14, Math.ceil(height / scale / 14) * 14];
    log.debug('depthSize', depthSize);
    const prepStep = this.getDepthPrepStep({
      ...params,
      outputSize: depthSize,
    });
    const bgUpdater = this.getCachedBgUpdater(params);

    const maskSize = depthSize;
    const maskWarp = this.getMaskWarpStep({ ...params, outputSize: maskSize }, [width / maskSize[0], height / maskSize[1]]);
    const gaussianBlur = this.getGaussianBlurStep();

    let t0 = performance.now();
    const machineTex = await prepStep.process(tex);
    log.debug('prepStep', performance.now() - t0);
    t0 = performance.now();
    const depthOutput = await this.getDepthEstimator().process(machineTex);
    log.debug('depthEstimator', performance.now() - t0);

    const bgMaskTex = await this.getBgMaskInflationStep().process(depthOutput);
    log.debug('bgMaskInflation', performance.now() - t0);

    const renderMaskTex = await this.getRenderMaskInflationStep().process(depthOutput);
    // log.debug('renderMaskInflation', performance.now() - t0);

    // Warp blurred masks back to camera space
    t0 = performance.now();
    const camMaskTex = await maskWarp.process(bgMaskTex);
    const camRenderMaskTex = await maskWarp.process(renderMaskTex);
    log.debug('maskWarpStep', performance.now() - t0);

    t0 = performance.now();
    const blurredMaskTex = await gaussianBlur.process(camMaskTex);
    const blurredRenderMaskTex = await gaussianBlur.process(camRenderMaskTex);
    log.debug('gaussianBlur', performance.now() - t0);

    t0 = performance.now();
    const updatedBg = await bgUpdater.update(tex, blurredMaskTex, this.cachedBg!);
    blurredMaskTex.destroy();
    log.debug('cachedBgUpdater', performance.now() - t0);
    // Update cached background
    const copyEncoder = this.ensureDevice().createCommandEncoder();
    copyEncoder.copyTextureToTexture({ texture: updatedBg }, { texture: this.cachedBg! }, [updatedBg.width, updatedBg.height]);
    this.ensureDevice().queue.submit([copyEncoder.finish()]);
    log.debug('cachedBgUpdater', performance.now() - t0);

    const renderedTex = await bgUpdater.update(tex, blurredRenderMaskTex, this.cachedBg!);
    blurredRenderMaskTex.destroy();
    updatedBg.destroy();
    tex.destroy();
    // return updatedBg;
    return renderedTex;
    // return updatedTex;
  }

  async init(stream: ReadableStream<VideoFrame> | MediaStreamTrack, cfg: Config): Promise<void> {
    if (!navigator.gpu) throw new Error('WebGPU not supported');
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) throw new Error('No GPU adapter');
    this.device = await adapter.requestDevice();
    this.reader = ensureReadableStream(stream).getReader();

    this.cfg = cfg;
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

  private async _throttleFrameRate() {
    while (performance.now() - this.lastFrameTime < 1000 / this.frameRateLimit) {
      await new Promise(r => requestAnimationFrame(r));
    }
  }

  async process(): Promise<ImageBitmap> {
    if (!this.reader || !this.device || !this.cfg) throw new Error('Worker not initialized');
    await this._throttleFrameRate();

    const t0All = performance.now();

    const { value: frame, done } = await this.reader.read();
    if (done || !frame) throw new Error('Stream ended');
    const width = frame.displayWidth || frame.codedWidth;
    const height = frame.displayHeight || frame.codedHeight;

    // Lazily create blitter once we know frame dimensions.
    if (!this.blitter) {
      this.blitter = new TextureBlitter(this.device!, width, height);
    }

    const tex = this.device.createTexture({
      label: 'srcTex',
      size: [width, height],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC | GPUTextureUsage.RENDER_ATTACHMENT,
    });
    this.device.queue.copyExternalImageToTexture({ source: frame }, { texture: tex }, [width, height]);
    frame.close();

    if (!this.cachedBg && this.cfg.mode === 'depth') {
      // Initialize cached background with the first frame
      this.cachedBg = await this.getUndistortStep(this.cfg.params).process(tex);
    }

    let updatedTex = tex;
    try {
      if (this.cfg.mode === 'undistort') {
        updatedTex = await this.runUndistort(tex, this.cfg.params);
      } else if (this.cfg.mode === 'camToMachine') {
        updatedTex = await this.runCamToMachine(tex, this.cfg.params);
      } else if (this.cfg.mode === 'machineToCam') {
        updatedTex = await this.runMachineToCam(tex, this.cfg.params);
      } else if (this.cfg.mode === 'depth') {
        updatedTex = await this.runDepth(tex, this.cfg.params, width, height);
      } else if (this.cfg.mode === 'none') {
        // No processing needed
      }
    } catch (e) {
      console.error('Error in processing:', e);
      throw new Error('Error in processing');
    }

    const bitmap = this.blitter.blit(updatedTex);
    log.debug('total time', performance.now() - t0All);
    this.lastFrameTime = performance.now();
    return bitmap;
  }
}

registerThreeJsTransferHandlers();
const worker = new VideoPipelineWorker();
Comlink.expose(worker);

(self as any).onerror = (e: ErrorEvent) => console.error('[VideoPipelineWorker] uncaught:', e);
