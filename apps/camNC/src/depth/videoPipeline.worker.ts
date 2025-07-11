import { ensureReadableStream, registerThreeJsTransferHandlers, ReplaceableStreamWorker } from '@wbcnc/video-worker-utils';
import * as Comlink from 'comlink';
import log from 'loglevel';
import { DepthEstimationStep } from './depthPipeline';
import { GaussianBlurStep } from './gaussianBlurStep';
import { MaskBlendStep } from './maskBlendStep';
import { MaskInflationStep } from './maskInflationStep';
import { CamToMachineStep, MachineToCamStep, RemapStepParams, UndistortParams, UndistortStep } from './remapPipeline';
import { TextureBlitter } from './textureBlitter';
log.setDefaultLevel(log.levels.INFO);

// Default configuration values – can be tuned at runtime via updateSettings().

// Wrapped in class instance, defaults defined here for readability only.

export type Mode = 'undistort' | 'camToMachine' | 'machineToCam' | 'depth';
export type Config =
  | { mode: 'undistort'; params: UndistortParams }
  | { mode: 'camToMachine'; params: RemapStepParams }
  | { mode: 'machineToCam'; params: RemapStepParams }
  | { mode: 'depth'; params: RemapStepParams }
  | { mode: 'none' };

export interface DepthFrameResult {
  mask: ImageBitmap;
  bg: ImageBitmap;
}

export interface VideoPipelineWorkerAPI extends ReplaceableStreamWorker {
  init(stream: ReadableStream<VideoFrame> | MediaStreamTrack, cfg: Config): Promise<void>;
  /**
   * Start internal processing loop and stream results to the provided callback on the main thread.
   */
  start(cb: any): Promise<void>;
  /** Stop processing loop */
  stop(): Promise<void>;
  /** Update processing parameters (e.g., calibration/extrinsics) without restarting worker */
  updateParams(params: RemapStepParams): Promise<void>;
  /** Update runtime settings such as FPS limit or mask margins */
  updateSettings(settings: WorkerSettings): Promise<void>;
}

/** Settings that can be adjusted at runtime from the main thread. */
export interface WorkerSettings {
  /** Maximum number of depth estimation frames per second. Values < 1 mean one frame every \(1/value\) seconds */
  frameRateLimit?: number;
  /** Pixel margin used when inflating background update mask. */
  bgMargin?: number;
  /** Pixel margin used when inflating render mask. */
  renderMargin?: number;
  thresholdOffset?: number;
}

// Simple per-worker cache to reuse GPUTextures between frames.
type TexKey = string;

function makeKey(w: number, h: number, tag: string) {
  return `${tag}_${w}x${h}`;
}

class VideoPipelineWorker implements VideoPipelineWorkerAPI {
  private reader: ReadableStreamDefaultReader<VideoFrame> | null = null;
  private device: GPUDevice | null = null;
  private blitter: TextureBlitter | null = null;
  private cfg: Config | null = null;

  // Throttle processing to this frame rate.
  private frameRateLimit = 1 / 2; // 0.5 fps -> one frame every 2 s
  private lastFrameTime = 0;

  // Runtime-configurable margins (defaults match previous constants)
  private bgUpdateMaskMargin = 50;
  private renderMaskMargin = 10;
  private thresholdOffset = 5;

  // Cached step instances to avoid per-frame pipeline creation
  private undistortStep?: UndistortStep;
  private camToMachineStep?: CamToMachineStep;
  private machineToCamStep?: MachineToCamStep;
  private maskBlendStep?: MaskBlendStep;
  private depthEstimator?: DepthEstimationStep;
  private bgMaskInflationStep?: MaskInflationStep;
  private renderMaskInflationStep?: MaskInflationStep;
  private gaussianBlurStep?: GaussianBlurStep;

  private cachedBg: GPUTexture | null = null;

  /** Reusable intermediate textures keyed by `${tag}_${w}x${h}`. */
  private texCache: Map<TexKey, GPUTexture> = new Map();

  /** Acquire a texture matching size; creates once and reuses. */
  private acquireTex(
    width: number,
    height: number,
    tag: string,
    usage: number = GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC | GPUTextureUsage.STORAGE_BINDING
  ): GPUTexture {
    const key = makeKey(width, height, tag);
    const existing = this.texCache.get(key);
    if (existing && existing.width === width && existing.height === height) return existing;

    existing?.destroy(); // size changed – destroy old

    const tex = this.ensureDevice().createTexture({
      label: `${tag} (${width}x${height})`,
      size: [width, height],
      format: 'rgba8unorm',
      usage,
    });
    this.texCache.set(key, tex);
    return tex;
  }

  /** Utility to ensure GPU device is present */
  private ensureDevice(): GPUDevice {
    if (!this.device) throw new Error('GPU device not ready');
    return this.device;
  }

  /** Lazily create / return UndistortStep */
  private getUndistortStep(): UndistortStep {
    if (!this.undistortStep) {
      this.undistortStep = new UndistortStep(this.ensureDevice());
    }
    return this.undistortStep;
  }

  /** Lazily create / return CamToMachineStep */
  private getCamToMachineStep(): CamToMachineStep {
    if (!this.camToMachineStep) {
      this.camToMachineStep = new CamToMachineStep(this.ensureDevice());
    }
    return this.camToMachineStep;
  }

  /** Lazily create / return MachineToCamStep */
  private getMachineToCamStep(): MachineToCamStep {
    if (!this.machineToCamStep) {
      this.machineToCamStep = new MachineToCamStep(this.ensureDevice());
    }
    return this.machineToCamStep;
  }

  /** Lazily create / return DepthEstimationStep */
  private getDepthEstimator(): DepthEstimationStep {
    if (!this.depthEstimator) {
      this.depthEstimator = new DepthEstimationStep(this.ensureDevice());
    }
    return this.depthEstimator;
  }

  private getMaskBlendStep(): MaskBlendStep {
    if (!this.maskBlendStep) {
      this.maskBlendStep = new MaskBlendStep(this.ensureDevice());
    }
    return this.maskBlendStep;
  }

  private getBgMaskInflationStep(): MaskInflationStep {
    if (!this.bgMaskInflationStep || this.bgMaskInflationStep.margin !== this.bgUpdateMaskMargin) {
      this.bgMaskInflationStep = new MaskInflationStep(this.ensureDevice(), this.bgUpdateMaskMargin);
    }
    return this.bgMaskInflationStep;
  }

  private getRenderMaskInflationStep(): MaskInflationStep {
    if (!this.renderMaskInflationStep || this.renderMaskInflationStep.margin !== this.renderMaskMargin) {
      this.renderMaskInflationStep = new MaskInflationStep(this.ensureDevice(), this.renderMaskMargin);
    }
    return this.renderMaskInflationStep;
  }

  private getGaussianBlurStep(): GaussianBlurStep {
    if (!this.gaussianBlurStep) {
      this.gaussianBlurStep = new GaussianBlurStep(this.ensureDevice());
    }
    return this.gaussianBlurStep;
  }

  private async runDepth(tex: GPUTexture, params: RemapStepParams): Promise<{ mask: GPUTexture; bg: GPUTexture }> {
    const { width, height } = tex;
    // Matches size and multiple requirement of
    // https://huggingface.co/depth-anything/Depth-Anything-V2-Small-hf/blob/main/preprocessor_config.json
    const scale = Math.max(width / 518, height / 518);
    const depthSize: [number, number] = [Math.ceil(width / scale / 14) * 14, Math.ceil(height / scale / 14) * 14];
    log.debug('depthSize', depthSize);

    let t0 = performance.now();
    const t00 = performance.now();

    // ---- 1. cam → machine space (fixed depthSize) ----
    const machineDst = this.acquireTex(depthSize[0], depthSize[1], 'machine');
    const prepParams: RemapStepParams = {
      ...params,
      outputSize: depthSize,
    };
    const machineTex = await this.getCamToMachineStep().process(tex, prepParams, machineDst);
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

    const camMaskDst = this.acquireTex(depthSize[0], depthSize[1], 'camMask');
    const camRenderMaskDst = this.acquireTex(depthSize[0], depthSize[1], 'camRenderMask');

    const maskWarpParams = {
      params: { ...params, outputSize: depthSize },
      scale: [width / depthSize[0], height / depthSize[1]] as [number, number],
    };
    const camMaskTex = await this.getMachineToCamStep().process(bgMaskTex, maskWarpParams, camMaskDst);
    const camRenderMaskTex = await this.getMachineToCamStep().process(renderMaskTex, maskWarpParams, camRenderMaskDst);
    log.debug('maskWarpStep', performance.now() - t0);

    t0 = performance.now();

    const blurredMaskDst = this.acquireTex(depthSize[0], depthSize[1], 'blurMask');
    const blurredRenderMaskDst = this.acquireTex(depthSize[0], depthSize[1], 'blurRenderMask');

    const blurredMaskTex = await this.getGaussianBlurStep().process(camMaskTex, blurredMaskDst);
    const blurredRenderMaskTex = await this.getGaussianBlurStep().process(camRenderMaskTex, blurredRenderMaskDst);
    log.debug('gaussianBlur', performance.now() - t0);

    t0 = performance.now();
    const bgBlendDst = this.acquireTex(width, height, 'bgBlend');
    const updatedBg = await this.getMaskBlendStep().process(tex, blurredMaskTex, this.cachedBg!, params, bgBlendDst);
    // Do not destroy blurredMaskTex here; keep for reuse.
    log.debug('cachedBgUpdater', performance.now() - t0);
    // Update cached background
    const copyEncoder = this.ensureDevice().createCommandEncoder();
    copyEncoder.copyTextureToTexture({ texture: updatedBg }, { texture: this.cachedBg! }, [updatedBg.width, updatedBg.height]);
    this.ensureDevice().queue.submit([copyEncoder.finish()]);
    log.debug('cachedBgUpdater', performance.now() - t0);
    log.debug('depth fps', 1000 / (performance.now() - t00));

    return { mask: blurredRenderMaskTex, bg: this.cachedBg! };
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

  private running = false;
  private cb: any = null;
  private loopPromise: Promise<void> | null = null;
  private transition: Promise<void> = Promise.resolve();

  async start(cb: any): Promise<void> {
    this.cb = cb;
    this.transition = this.transition
      .then(async () => {
        if (this.running) return;
        if (this.loopPromise) await this.loopPromise;
        this.running = true;
        this.loopPromise = this.loop();
      })
      .catch(console.error);
    await this.transition;
  }

  async stop(): Promise<void> {
    this.transition = this.transition
      .then(async () => {
        if (!this.running) return;
        this.running = false;
        await this.loopPromise;
        this.loopPromise = null;
      })
      .catch(console.error);
    await this.transition;
  }

  private async loop() {
    while (this.running) {
      try {
        const result = await this.processFrame();
        if (this.cb && result) this.cb(result);
      } catch (err) {
        console.error('[VideoPipelineWorker] loop error', err);
        // stop on error
        this.running = false;
      }
    }
  }

  /** internal: processes one frame and returns depth result */
  private async processFrame(): Promise<DepthFrameResult | null> {
    if (!this.reader || !this.device || !this.cfg) throw new Error('Worker not initialized');

    await this._throttleFrameRate();
    this.lastFrameTime = performance.now();

    const { value: frame, done } = await this.reader.read();
    if (done || !frame) return null;
    const width = frame.displayWidth || frame.codedWidth;
    const height = frame.displayHeight || frame.codedHeight;

    if (!this.blitter) this.blitter = new TextureBlitter(this.device!, width, height);

    const tex = this.acquireTex(
      width,
      height,
      'srcTex',
      GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC | GPUTextureUsage.RENDER_ATTACHMENT
    );
    this.device.queue.copyExternalImageToTexture({ source: frame }, { texture: tex }, [width, height]);
    frame.close();

    if (!this.cachedBg && this.cfg.mode === 'depth') {
      this.cachedBg = await this.getUndistortStep().process(tex, this.cfg.params);
    }

    if (this.cfg.mode !== 'depth') return null;

    const { mask, bg } = await this.runDepth(tex, this.cfg.params);

    // Convert mask & bg to ImageBitmap via blitter(s)
    const maskBlitter = new TextureBlitter(this.device!, mask.width, mask.height);
    const maskBmp = maskBlitter.blit(mask);
    const bgBmp = this.blitter!.blit(bg);

    // log.info('fps', 1000 / (performance.now() - this.lastFrameTime));
    return Comlink.transfer({ mask: maskBmp, bg: bgBmp }, [maskBmp, bgBmp]);
  }

  // The old on-demand process() API is deprecated – kept for debug route compatibility
  async process(): Promise<ImageBitmap> {
    throw new Error('process() is deprecated – use start() streaming instead');
  }

  async updateParams(params: RemapStepParams): Promise<void> {
    if (this.cfg && this.cfg.mode !== 'none') {
      // Only update if structurally compatible
      this.cfg = { ...this.cfg, params } as any;
    }
  }

  /** Apply runtime settings (frame rate limit, mask margins) without restarting. */
  async updateSettings({ frameRateLimit, bgMargin, renderMargin, thresholdOffset }: WorkerSettings): Promise<void> {
    if (frameRateLimit !== undefined && frameRateLimit > 0) {
      this.frameRateLimit = frameRateLimit;
    }

    if (bgMargin !== undefined && bgMargin !== this.bgUpdateMaskMargin) {
      this.bgUpdateMaskMargin = Math.max(0, bgMargin | 0);
    }

    if (renderMargin !== undefined && renderMargin !== this.renderMaskMargin) {
      this.renderMaskMargin = Math.max(0, renderMargin | 0);
    }

    if (thresholdOffset !== undefined) {
      this.thresholdOffset = thresholdOffset;
    }
  }
}

registerThreeJsTransferHandlers();
const worker = new VideoPipelineWorker();
Comlink.expose(worker);

(self as any).onerror = (e: ErrorEvent) => console.error('[VideoPipelineWorker] uncaught:', e);
