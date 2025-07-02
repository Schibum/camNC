import { RemapStepParams } from '@/depth/remapPipeline';
import { Config, VideoPipelineWorkerAPI } from '@/depth/videoPipeline.worker';
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
  private maskCanvas: HTMLCanvasElement | null = null;
  private bgCanvas: HTMLCanvasElement | null = null;

  // State
  private isRunning = false;
  private isInitialized = false;
  private currentVideoSource: any = null;
  private currentParams: RemapStepParams | null = null;
  private onTextureUpdate: ((textures: DepthBlendTextures) => void) | null = null;

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
      const workerUrl = new URL('./videoPipeline.worker.ts', import.meta.url);
      this.worker = new Worker(workerUrl, { type: 'module' });
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

    // Track if new textures were created this frame
    let texturesChanged = false;

    // Create or update canvases
    if (!this.maskCanvas || !this.bgCanvas) {
      this.maskCanvas = document.createElement('canvas');
      this.maskCanvas.width = result.mask.width;
      this.maskCanvas.height = result.mask.height;

      this.bgCanvas = document.createElement('canvas');
      this.bgCanvas.width = result.bg.width;
      this.bgCanvas.height = result.bg.height;

      // Create new textures
      this.createTextures();

      texturesChanged = true;
    } else {
      // Resize if needed
      if (this.maskCanvas.width !== result.mask.width || this.maskCanvas.height !== result.mask.height) {
        this.maskCanvas.width = result.mask.width;
        this.maskCanvas.height = result.mask.height;
        // CanvasTexture automatically picks up size change on next upload
      }
      if (this.bgCanvas.width !== result.bg.width || this.bgCanvas.height !== result.bg.height) {
        this.bgCanvas.width = result.bg.width;
        this.bgCanvas.height = result.bg.height;
        // CanvasTexture automatically picks up size change on next upload
      }
    }

    // Draw to canvases
    const maskCtx = this.maskCanvas!.getContext('2d')!;
    maskCtx.drawImage(result.mask, 0, 0);

    const bgCtx = this.bgCanvas!.getContext('2d')!;
    bgCtx.drawImage(result.bg, 0, 0);

    // Update textures
    if (this.maskTex && this.bgTex) {
      this.maskTex.needsUpdate = true;
      this.bgTex.needsUpdate = true;
    }

    // Close ImageBitmaps
    result.mask.close();
    result.bg.close();

    // Notify listeners only if we created new textures
    if (texturesChanged && this.onTextureUpdate && this.maskTex && this.bgTex) {
      this.onTextureUpdate({ mask: this.maskTex, bg: this.bgTex });
    }
  }

  /**
   * Create new textures from canvases
   */
  private createTextures() {
    if (!this.maskCanvas || !this.bgCanvas) return;

    // Dispose old textures if they exist
    if (this.maskTex) this.maskTex.dispose();
    if (this.bgTex) this.bgTex.dispose();

    this.maskTex = new THREE.CanvasTexture(this.maskCanvas);
    this.maskTex.flipY = false;
    this.maskTex.minFilter = this.maskTex.magFilter = THREE.LinearFilter;
    this.maskTex.generateMipmaps = false;
    this.maskTex.wrapS = this.maskTex.wrapT = THREE.ClampToEdgeWrapping;

    this.bgTex = new THREE.CanvasTexture(this.bgCanvas);
    this.bgTex.flipY = false;
    this.bgTex.generateMipmaps = false;
    this.bgTex.minFilter = this.bgTex.magFilter = THREE.LinearFilter;
    this.bgTex.wrapS = this.bgTex.wrapT = THREE.ClampToEdgeWrapping;
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
    this.maskCanvas = null;
    this.bgCanvas = null;

    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }

    this.proxy = null;
    DepthBlendManager.instance = null;
  }
}
