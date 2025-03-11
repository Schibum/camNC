/**
 * Undistort.ts - Camera undistortion module for real-time video
 * Uses WebGPU (preferred) or OpenCV.js (fallback) for lens undistortion
 *
 * Modified for ES module compatibility
 */

// WebGPU type declarations - may need to be enhanced or imported based on project setup
declare global {
  interface Navigator {
    gpu?: {
      requestAdapter(): Promise<GPUAdapter | null>;
      getPreferredCanvasFormat(): string;
    };
  }

  interface GPUAdapter {
    requestDevice(): Promise<GPUDevice>;
  }

  interface GPUDevice {
    createTexture(descriptor: any): GPUTexture;
    createShaderModule(descriptor: any): GPUShaderModule;
    createComputePipeline(descriptor: any): GPUComputePipeline;
    createRenderPipeline(descriptor: any): GPURenderPipeline;
    createSampler(descriptor: any): GPUSampler;
    createBindGroup(descriptor: any): GPUBindGroup;
    createCommandEncoder(): GPUCommandEncoder;
    queue: GPUQueue;
  }

  interface GPUTexture {
    createView(): GPUTextureView;
    destroy(): void;
  }

  interface GPUCommandEncoder {
    beginComputePass(): GPUComputePassEncoder;
    beginRenderPass(descriptor: any): GPURenderPassEncoder;
    finish(): GPUCommandBuffer;
  }

  interface GPUComputePassEncoder {
    setPipeline(pipeline: GPUComputePipeline): void;
    setBindGroup(index: number, bindGroup: GPUBindGroup): void;
    dispatchWorkgroups(x: number, y: number, z?: number): void;
    end(): void;
  }

  interface GPURenderPassEncoder {
    setPipeline(pipeline: GPURenderPipeline): void;
    setBindGroup(index: number, bindGroup: GPUBindGroup): void;
    draw(
      vertexCount: number,
      instanceCount?: number,
      firstVertex?: number,
      firstInstance?: number
    ): void;
    end(): void;
  }

  interface GPUQueue {
    writeTexture(destination: any, data: ArrayBufferView, dataLayout: any, size: any): void;
    copyExternalImageToTexture(source: any, destination: any, copySize: any): void;
    submit(commandBuffers: GPUCommandBuffer[]): void;
  }

  interface GPUComputePipeline {
    getBindGroupLayout(index: number): GPUBindGroupLayout;
  }

  interface GPURenderPipeline {
    getBindGroupLayout(index: number): GPUBindGroupLayout;
  }

  interface GPUBindGroupLayout {}
  interface GPUShaderModule {}
  interface GPUSampler {}
  interface GPUBindGroup {}
  interface GPUTextureView {}
  interface GPUCommandBuffer {}

  // Make types available globally as they're used in the original code
  const GPUTextureUsage: {
    TEXTURE_BINDING: number;
    COPY_DST: number;
    RENDER_ATTACHMENT: number;
    STORAGE_BINDING: number;
    COPY_SRC: number;
  };
}

/**
 * Calibration data interface containing camera matrix and distortion coefficients
 */
export interface CalibrationData {
  calibration_matrix: number[][];
  distortion_coefficients: number[][];
}

/**
 * Configuration options for the CameraUndistorter
 */
export interface CameraUndistorterOptions {
  calibrationData: CalibrationData;
  videoElement: HTMLVideoElement;
  outputCanvas: HTMLCanvasElement;
  preferWebGPU?: boolean;
  cv?: any;
}

/**
 * Information about the renderer being used
 */
export interface RendererInfo {
  initialized: boolean;
  type: 'webgpu' | 'cpu';
  [key: string]: any;
}

/**
 * Internal renderer interface
 */
interface Renderer {
  type: 'webgpu' | 'cpu';
  processFrame(): Promise<void>;
  dispose(): void;
  getInfo(): Record<string, any>;
}

/**
 * Checks if WebGPU is supported in the current browser.
 * @returns Whether WebGPU is supported
 */
export async function isWebGPUSupported(): Promise<boolean> {
  if (!navigator.gpu) {
    return false;
  }

  try {
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) {
      return false;
    }

    // We don't need to keep the device, just checking if we can create one
    await adapter.requestDevice();
    return true;
  } catch (e) {
    console.warn('WebGPU supported but failed to initialize:', e);
    return false;
  }
}

/**
 * Camera undistortion module that handles real-time video undistortion
 * using either WebGPU (preferred) or OpenCV.js (fallback).
 */
export class CameraUndistorter {
  private calibrationData: CalibrationData;
  private videoElement: HTMLVideoElement;
  private outputCanvas: HTMLCanvasElement;
  private preferWebGPU: boolean;
  private cv: any;
  private _initialized: boolean;
  private _renderer: Renderer | null;

  /**
   * Creates a new camera undistorter.
   */
  constructor({
    calibrationData,
    videoElement,
    outputCanvas,
    preferWebGPU = true,
    cv = null,
  }: CameraUndistorterOptions) {
    // Store parameters and initialize basic state
    this.calibrationData = calibrationData;
    this.videoElement = videoElement;
    this.outputCanvas = outputCanvas;
    this.preferWebGPU = preferWebGPU;
    this.cv = cv;

    // Internal state
    this._initialized = false;
    this._renderer = null; // Will hold WebGPU or CPU renderer
  }

  /**
   * Initializes the undistorter. Must be called before processFrame().
   * @returns Whether initialization was successful
   */
  async initialize(): Promise<boolean> {
    if (this._initialized) return true;

    try {
      // Configure output canvas dimensions to match video
      if (
        this.outputCanvas.width !== this.videoElement.videoWidth ||
        this.outputCanvas.height !== this.videoElement.videoHeight
      ) {
        this.outputCanvas.width = this.videoElement.videoWidth;
        this.outputCanvas.height = this.videoElement.videoHeight;
      }

      // Try WebGPU first if preferred
      if (this.preferWebGPU) {
        const webGPUSupported = await isWebGPUSupported();
        if (webGPUSupported) {
          this._renderer = await initializeWebGPURenderer(
            this.calibrationData,
            this.videoElement,
            this.outputCanvas
          );
          this._initialized = true;
          return true;
        }
      }

      // Fall back to CPU/OpenCV.js if WebGPU not available or not preferred
      if (this.cv) {
        this._renderer = initializeCPURenderer(
          this.calibrationData,
          this.videoElement,
          this.outputCanvas,
          this.cv
        );
        this._initialized = true;
        return true;
      }

      throw new Error('Neither WebGPU nor OpenCV.js available for undistortion');
    } catch (error) {
      console.error('Initialization error:', error);
      return false;
    }
  }

  /**
   * Processes a single frame and renders it to the output canvas.
   * Call this method whenever you want to render an undistorted frame.
   */
  async processFrame(): Promise<void> {
    if (!this._initialized) {
      throw new Error('Undistorter not initialized. Call initialize() first.');
    }

    return this._renderer!.processFrame();
  }

  /**
   * Cleans up resources. Call when the undistorter is no longer needed.
   */
  dispose(): void {
    if (this._renderer) {
      this._renderer.dispose();
      this._renderer = null;
    }
    this._initialized = false;
  }

  /**
   * Returns information about the current renderer.
   * @returns Information about active renderer
   */
  getRendererInfo(): RendererInfo {
    if (!this._initialized) {
      return { initialized: false, type: 'cpu' };
    }

    return {
      initialized: true,
      type: this._renderer!.type, // 'webgpu' or 'cpu'
      ...this._renderer!.getInfo(),
    };
  }
}

/**
 * Internal WebGPU implementation functions
 */
async function initializeWebGPURenderer(
  calibrationData: CalibrationData,
  videoElement: HTMLVideoElement,
  outputCanvas: HTMLCanvasElement
): Promise<Renderer> {
  const adapter = await navigator.gpu!.requestAdapter();
  const device = await adapter!.requestDevice();

  // Get WebGPU context from canvas
  const context = outputCanvas.getContext('webgpu') as any;
  const canvasFormat = navigator.gpu!.getPreferredCanvasFormat();
  context.configure({
    device: device,
    format: canvasFormat,
    alphaMode: 'premultiplied',
  });

  // Create undistortion maps from calibration data
  const { mapXTexture, mapYTexture } = await createWebGPUMaps(
    calibrationData,
    videoElement.videoWidth,
    videoElement.videoHeight,
    device
  );

  // Create compute shader for undistortion
  const remapPipeline = device.createComputePipeline({
    layout: 'auto',
    compute: {
      module: device.createShaderModule({
        code: `
          @group(0) @binding(0) var inputTexture: texture_2d<f32>;
          @group(0) @binding(1) var mapX: texture_2d<f32>;
          @group(0) @binding(2) var mapY: texture_2d<f32>;
          @group(0) @binding(3) var outputTexture: texture_storage_2d<rgba8unorm, write>;
          @group(0) @binding(4) var mySampler: sampler;

          @compute @workgroup_size(16, 16)
          fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
            let dims = textureDimensions(outputTexture);
            let coord = vec2<u32>(global_id.xy);

            if (coord.x >= dims.x || coord.y >= dims.y) {
              return;
            }

            // Get the source coordinates from the map textures
            let x = textureLoad(mapX, vec2<i32>(coord), 0).r;
            let y = textureLoad(mapY, vec2<i32>(coord), 0).r;

            // Normalize to texture coordinates
            let texCoord = vec2<f32>(x / f32(dims.x), y / f32(dims.y));

            // Sample the input texture
            let color = textureSampleLevel(inputTexture, mySampler, texCoord, 0.0);

            // Write to output
            textureStore(outputTexture, vec2<i32>(coord), color);
          }
        `,
      }),
      entryPoint: 'main',
    },
  });

  // Create sampler
  const sampler = device.createSampler({
    magFilter: 'linear',
    minFilter: 'linear',
  });

  // Create render pipeline for display
  const blitShaderModule = device.createShaderModule({
    code: `
      @vertex
      fn vertexMain(@builtin(vertex_index) vertexIndex: u32) -> @builtin(position) vec4<f32> {
        var pos = array<vec2<f32>, 6>(
          vec2<f32>(-1.0, -1.0),
          vec2<f32>(1.0, -1.0),
          vec2<f32>(-1.0, 1.0),
          vec2<f32>(-1.0, 1.0),
          vec2<f32>(1.0, -1.0),
          vec2<f32>(1.0, 1.0)
        );
        return vec4<f32>(pos[vertexIndex], 0.0, 1.0);
      }

      @group(0) @binding(0) var texSampler: sampler;
      @group(0) @binding(1) var tex: texture_2d<f32>;

      @fragment
      fn fragmentMain(@builtin(position) fragCoord: vec4<f32>) -> @location(0) vec4<f32> {
        let texCoord = vec2<f32>(
          (fragCoord.x / ${videoElement.videoWidth}.0),
          (fragCoord.y / ${videoElement.videoHeight}.0)
        );
        return textureSample(tex, texSampler, texCoord);
      }
    `,
  });

  const blitPipeline = device.createRenderPipeline({
    layout: 'auto',
    vertex: {
      module: blitShaderModule,
      entryPoint: 'vertexMain',
    },
    fragment: {
      module: blitShaderModule,
      entryPoint: 'fragmentMain',
      targets: [{ format: canvasFormat }],
    },
    primitive: {
      topology: 'triangle-list',
    },
  });

  return {
    type: 'webgpu',

    async processFrame() {
      // Create texture for the video frame
      const videoTexture = device.createTexture({
        size: [videoElement.videoWidth, videoElement.videoHeight],
        format: 'rgba8unorm',
        usage:
          GPUTextureUsage.TEXTURE_BINDING |
          GPUTextureUsage.COPY_DST |
          GPUTextureUsage.RENDER_ATTACHMENT,
      });

      // Copy video frame to texture
      device.queue.copyExternalImageToTexture({ source: videoElement }, { texture: videoTexture }, [
        videoElement.videoWidth,
        videoElement.videoHeight,
      ]);

      // Create output texture
      const outputTexture = device.createTexture({
        size: [videoElement.videoWidth, videoElement.videoHeight],
        format: 'rgba8unorm',
        usage:
          GPUTextureUsage.STORAGE_BINDING |
          GPUTextureUsage.RENDER_ATTACHMENT |
          GPUTextureUsage.COPY_SRC |
          GPUTextureUsage.TEXTURE_BINDING,
      });

      // Set up bind group for compute
      const computeBindGroup = device.createBindGroup({
        layout: remapPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: videoTexture.createView() },
          { binding: 1, resource: mapXTexture.createView() },
          { binding: 2, resource: mapYTexture.createView() },
          { binding: 3, resource: outputTexture.createView() },
          { binding: 4, resource: sampler },
        ],
      });

      // Execute compute pass
      const commandEncoder = device.createCommandEncoder();
      const passEncoder = commandEncoder.beginComputePass();
      passEncoder.setPipeline(remapPipeline);
      passEncoder.setBindGroup(0, computeBindGroup);
      passEncoder.dispatchWorkgroups(
        Math.ceil(videoElement.videoWidth / 16),
        Math.ceil(videoElement.videoHeight / 16)
      );
      passEncoder.end();

      // Set up bind group for render
      const blitBindGroup = device.createBindGroup({
        layout: blitPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: sampler },
          { binding: 1, resource: outputTexture.createView() },
        ],
      });

      // Render to canvas
      const canvasTexture = context.getCurrentTexture();
      const renderPassDescriptor = {
        colorAttachments: [
          {
            view: canvasTexture.createView(),
            clearValue: { r: 0.0, g: 0.0, b: 0.0, a: 1.0 },
            loadOp: 'clear',
            storeOp: 'store',
          },
        ],
      };

      const renderPass = commandEncoder.beginRenderPass(renderPassDescriptor);
      renderPass.setPipeline(blitPipeline);
      renderPass.setBindGroup(0, blitBindGroup);
      renderPass.draw(6); // 6 vertices for 2 triangles
      renderPass.end();

      device.queue.submit([commandEncoder.finish()]);

      // Clean up temporary textures
      setTimeout(() => {
        videoTexture.destroy();
        outputTexture.destroy();
      }, 0);
    },

    dispose() {
      mapXTexture.destroy();
      mapYTexture.destroy();
      // The device and other resources will be cleaned up automatically
    },

    getInfo() {
      return {
        format: canvasFormat,
        renderer: 'WebGPU',
      };
    },
  };
}

/**
 * Internal CPU/OpenCV.js implementation
 */
function initializeCPURenderer(
  calibrationData: CalibrationData,
  videoElement: HTMLVideoElement,
  outputCanvas: HTMLCanvasElement,
  cv: any
): Renderer {
  // Create OpenCV matrices and maps
  const cameraMatrix = cv.matFromArray(3, 3, cv.CV_64F, calibrationData.calibration_matrix.flat());
  const distCoeffs = cv.matFromArray(
    1,
    5,
    cv.CV_64F,
    calibrationData.distortion_coefficients.flat()
  );

  // Create destination matrices
  const src = new cv.Mat();
  const dst = new cv.Mat();
  const map1 = new cv.Mat();
  const map2 = new cv.Mat();

  // Generate remap maps
  const size = new cv.Size(videoElement.videoWidth, videoElement.videoHeight);
  cv.initUndistortRectifyMap(
    cameraMatrix,
    distCoeffs,
    new cv.Mat(), // No rectification
    cameraMatrix, // Use same camera matrix
    size,
    cv.CV_32FC1,
    map1,
    map2
  );

  return {
    type: 'cpu',

    async processFrame() {
      const ctx = outputCanvas.getContext('2d')!;

      // Draw video to canvas
      ctx.drawImage(videoElement, 0, 0, outputCanvas.width, outputCanvas.height);

      // Get image data
      const imgData = ctx.getImageData(0, 0, outputCanvas.width, outputCanvas.height);

      // Convert to OpenCV mat
      const inputMat = cv.matFromImageData(imgData);

      // Apply undistortion
      cv.remap(inputMat, dst, map1, map2, cv.INTER_LINEAR);

      // Convert back to canvas
      const outputData = new ImageData(new Uint8ClampedArray(dst.data), dst.cols, dst.rows);
      ctx.putImageData(outputData, 0, 0);

      // Clean up
      inputMat.delete();

      return Promise.resolve();
    },

    dispose() {
      src.delete();
      dst.delete();
      map1.delete();
      map2.delete();
      cameraMatrix.delete();
      distCoeffs.delete();
    },

    getInfo() {
      return {
        renderer: 'CPU/OpenCV.js',
      };
    },
  };
}

/**
 * Creates WebGPU textures for undistortion maps
 */
export async function createWebGPUMaps(
  calibrationData: CalibrationData,
  width: number,
  height: number,
  device: any
): Promise<{ mapXTexture: any; mapYTexture: any }> {
  // Use OpenCV.js to calculate the maps temporarily
  // In a real implementation, this should be done directly in WebGPU
  // but for compatibility with existing code, we'll use OpenCV.js first

  // Load OpenCV.js if needed
  if (typeof window !== 'undefined' && !(window as any).cv) {
    console.warn('OpenCV.js required to create initial undistortion maps');
    throw new Error('OpenCV.js not available to create maps');
  }

  const cv = (window as any).cv;

  // Create matrices for camera parameters
  const { calibration_matrix, distortion_coefficients } = calibrationData;
  const cameraMatrix = cv.matFromArray(3, 3, cv.CV_64F, calibration_matrix.flat());
  const distCoeffs = cv.matFromArray(1, 5, cv.CV_64F, distortion_coefficients.flat());

  // Generate remap maps
  const mapX = new cv.Mat();
  const mapY = new cv.Mat();
  const size = new cv.Size(width, height);

  cv.initUndistortRectifyMap(
    cameraMatrix,
    distCoeffs,
    new cv.Mat(), // No rectification
    cameraMatrix, // Use same camera matrix
    size,
    cv.CV_32FC1,
    mapX,
    mapY
  );

  // Convert OpenCV.js maps to WebGPU textures
  const mapXData = new Float32Array(mapX.data.buffer, mapX.data.byteOffset, mapX.rows * mapX.cols);
  const mapYData = new Float32Array(mapY.data.buffer, mapY.data.byteOffset, mapY.rows * mapY.cols);

  // Create WebGPU textures for the maps
  const mapXTexture = device.createTexture({
    size: [width, height],
    format: 'r32float',
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  });

  const mapYTexture = device.createTexture({
    size: [width, height],
    format: 'r32float',
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  });

  // Copy data to textures
  device.queue.writeTexture({ texture: mapXTexture }, mapXData, { bytesPerRow: width * 4 }, [
    width,
    height,
  ]);

  device.queue.writeTexture({ texture: mapYTexture }, mapYData, { bytesPerRow: width * 4 }, [
    width,
    height,
  ]);

  // Clean up OpenCV resources
  cameraMatrix.delete();
  distCoeffs.delete();
  mapX.delete();
  mapY.delete();

  return { mapXTexture, mapYTexture };
}
