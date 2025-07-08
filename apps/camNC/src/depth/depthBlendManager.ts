import { RemapStepParams } from '@/depth/remapPipeline';
import type { Config, VideoPipelineWorkerAPI, WorkerSettings } from '@/depth/videoPipeline.worker';
import { createVideoStreamProcessor, registerThreeJsTransferHandlers } from '@wbcnc/video-worker-utils';
import * as Comlink from 'comlink';
import * as THREE from 'three';

registerThreeJsTransferHandlers();

export interface DepthBlendTextures {
  mask: THREE.CanvasTexture | null;
  bg: THREE.CanvasTexture | null;
}

/**
 * Singleton manager for the depth blend worker and texture management.
 * Handles worker lifecycle, video processing, and texture updates.
 */
export class DepthBlendManager {
  private static instance: DepthBlendManager | null = null;

  private worker: Worker | null = null;
  private proxy: Comlink.Remote<VideoPipelineWorkerAPI> | null = null;
  private localStream: ReadableStream<VideoFrame> | MediaStreamTrack | null = null;

  // Texture management
  private maskTex: THREE.CanvasTexture | null = null;
  private bgTex: THREE.CanvasTexture | null = null;
  private bgCanvas: HTMLCanvasElement | null = null;

  // State
  private isRunning = false;
  private isInitialized = false;
  private currentVideoSource: any = null;
  private currentParams: RemapStepParams | null = null;
  private onTextureUpdate: ((textures: DepthBlendTextures) => void) | null = null;
  private pendingSettings: WorkerSettings | null = null;

  private constructor() {
    // Initialize worker immediately
    this.initWorker();
  }

  static getInstance(): DepthBlendManager {
    if (!DepthBlendManager.instance) {
      DepthBlendManager.instance = new DepthBlendManager();
    }
    return DepthBlendManager.instance;
  }

  private async initWorker() {
    try {
      this.worker = new Worker(new URL('./videoPipeline.worker.ts', import.meta.url), { type: 'module' });
      this.proxy = Comlink.wrap<VideoPipelineWorkerAPI>(this.worker);
    } catch (error) {
      console.error('[DepthBlendManager] Failed to initialize worker:', error);
    }
  }

  // Register a callback for texture updates
  onTextures(cb: (textures: DepthBlendTextures) => void) {
    this.onTextureUpdate = cb;
    // If textures already exist, send them immediately so the consumer
    // doesn't have to wait for the next frame before seeing something.
    if (this.maskTex && this.bgTex) {
      cb({ mask: this.maskTex, bg: this.bgTex });
    }
  }

  // Set or replace the video source
  async setVideoSource(videoSource: any) {
    const oldSource = this.currentVideoSource;
    this.currentVideoSource = videoSource;

    // Ensure worker exists
    if (!this.proxy) await this.initWorker();

    // If already initialised swap the stream immediately.
    if (this.isInitialized && oldSource !== videoSource) {
      await this.replaceVideoSource(videoSource);
    }
  }

  // Update processing parameters
  async setParams(params: RemapStepParams) {
    const changed = JSON.stringify(this.currentParams) !== JSON.stringify(params);
    this.currentParams = params;

    // Ensure worker exists
    if (!this.proxy) await this.initWorker();

    // If already initialised push update to worker immediately.
    if (this.isInitialized && changed) {
      await this.updateParams(params);
    }
  }

  /**
   * Ensure the worker is fully initialised. Assumes both currentVideoSource and
   * currentParams are already set.
   */
  private async ensureInitialized() {
    if (this.isInitialized) return;

    if (!this.currentVideoSource || !this.currentParams) {
      throw new Error('[DepthBlendManager] Cannot initialise without videoSource and params');
    }

    this.localStream = await createVideoStreamProcessor(this.currentVideoSource);
    const cfg: Config = { mode: 'depth', params: this.currentParams };

    await this.proxy!.init(Comlink.transfer(this.localStream as any, [this.localStream as any]), cfg);

    // Apply any pending processing settings that were set before initialization completed
    if (this.pendingSettings) {
      try {
        await this.proxy!.updateSettings(this.pendingSettings);
      } catch (err) {
        console.error('[DepthBlendManager] Failed to apply pending settings:', err);
      }
      this.pendingSettings = null;
    }
    this.isInitialized = true;
  }

  // Start processing
  async start() {
    if (!this.proxy) {
      console.error('[DepthBlendManager] Worker not initialised');
      return;
    }

    if (!this.isInitialized) {
      try {
        await this.ensureInitialized();
      } catch (err) {
        console.error(err);
        return;
      }
    }

    if (this.isRunning) return;

    this.isRunning = true;
    await this.proxy.start(Comlink.proxy(this.handleFrame.bind(this)));
  }

  // Stop processing
  async stop() {
    if (!this.proxy || !this.isRunning) return;

    this.isRunning = false;

    try {
      await this.proxy.stop();
    } catch (error) {
      console.error('[DepthBlendManager] Failed to stop:', error);
    }
  }

  /**
   * Update processing parameters without restarting
   */
  async updateParams(params: RemapStepParams) {
    if (!this.proxy || !this.isInitialized) return;

    this.currentParams = params;

    try {
      await this.proxy.updateParams(params);
    } catch (error) {
      console.error('[DepthBlendManager] Failed to update params:', error);
    }
  }

  /**
   * Update runtime processing settings (fps limit, mask margins) without restart.
   */
  async setProcessingSettings(settings: WorkerSettings) {
    if (!this.proxy || !this.isInitialized) {
      // Worker not ready yet – store for later
      this.pendingSettings = settings;
      return;
    }

    try {
      await this.proxy.updateSettings(settings);
    } catch (error) {
      console.error('[DepthBlendManager] Failed to update settings:', error);
    }
  }

  /**
   * Replace video stream without restarting the worker
   */
  async replaceVideoSource(videoSource: any) {
    if (!this.proxy || !this.isInitialized) return;

    this.currentVideoSource = videoSource;

    try {
      // Cancel old stream
      if (this.localStream instanceof ReadableStream) {
        this.localStream.cancel().catch(() => {});
      }

      // Create new stream
      this.localStream = await createVideoStreamProcessor(videoSource);

      // Replace in worker
      await this.proxy.replaceStream(Comlink.transfer(this.localStream as any, [this.localStream as any]) as any);
    } catch (error) {
      console.error('[DepthBlendManager] Failed to replace video source:', error);
    }
  }

  /**
   * Handle frame results from worker
   */
  private handleFrame(result: { mask: ImageBitmap; bg: ImageBitmap }) {
    if (!this.isRunning) return;

    // Ensure background canvas/texture exist (created once)
    if (!this.bgCanvas) {
      this.bgCanvas = document.createElement('canvas');
      this.bgCanvas.width = result.bg.width;
      this.bgCanvas.height = result.bg.height;

      this.bgTex = new THREE.CanvasTexture(this.bgCanvas);
      this.bgTex.flipY = false;
      this.bgTex.generateMipmaps = false;
      this.bgTex.minFilter = this.bgTex.magFilter = THREE.LinearFilter;
      this.bgTex.wrapS = this.bgTex.wrapT = THREE.ClampToEdgeWrapping;
    } else if (this.bgCanvas.width !== result.bg.width || this.bgCanvas.height !== result.bg.height) {
      this.bgCanvas.width = result.bg.width;
      this.bgCanvas.height = result.bg.height;
    }

    // Create NEW CanvasTexture for mask every frame (enables shader fade)

    // Create a dedicated canvas that is *not* re-used so the previous
    // Three.js texture retains the old pixels for cross-fading.
    const maskCanvas = document.createElement('canvas');
    maskCanvas.width = result.mask.width;
    maskCanvas.height = result.mask.height;
    maskCanvas.getContext('2d')!.drawImage(result.mask, 0, 0);

    const newMaskTex = new THREE.CanvasTexture(maskCanvas);
    newMaskTex.flipY = false;
    newMaskTex.minFilter = newMaskTex.magFilter = THREE.LinearFilter;
    newMaskTex.generateMipmaps = false;
    newMaskTex.wrapS = newMaskTex.wrapT = THREE.ClampToEdgeWrapping;

    // Keep reference to previous mask texture so shader can still sample it
    // (will be garbage-collected when no longer referenced on JS side).
    this.maskTex = newMaskTex;

    const bgCtx = this.bgCanvas!.getContext('2d')!;
    bgCtx.drawImage(result.bg, 0, 0);
    if (this.bgTex) this.bgTex.needsUpdate = true;

    // Close ImageBitmaps (mask was drawn into new canvas already)
    result.mask.close();
    result.bg.close();

    // Notify listeners every frame so React state sees new object
    if (this.onTextureUpdate && this.maskTex && this.bgTex) {
      this.onTextureUpdate({ mask: this.maskTex, bg: this.bgTex });
    }
  }

  /**
   * Destroy the manager and clean up all resources
   */
  destroy() {
    this.stop();

    // Dispose textures
    if (this.maskTex) {
      this.maskTex.dispose();
      this.maskTex = null;
    }
    if (this.bgTex) {
      this.bgTex.dispose();
      this.bgTex = null;
    }
    this.bgCanvas = null;

    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }

    this.proxy = null;
    DepthBlendManager.instance = null;
  }
}
