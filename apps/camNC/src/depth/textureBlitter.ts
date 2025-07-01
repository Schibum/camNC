/** For converting a GPUTexture to an ImageBitmap while keeping it on the GPU. */
export class TextureBlitter {
  private readonly device: GPUDevice;
  private readonly canvas: OffscreenCanvas;
  private readonly ctx: GPUCanvasContext;
  private readonly format: GPUTextureFormat;
  private readonly pipeline: GPURenderPipeline;
  private readonly sampler: GPUSampler;
  private readonly layout: GPUBindGroupLayout;

  constructor(device: GPUDevice, width: number, height: number, format: GPUTextureFormat = navigator.gpu.getPreferredCanvasFormat()) {
    this.device = device;
    this.format = format;

    // Create offscreen canvas & WebGPU context
    this.canvas = new OffscreenCanvas(width, height);
    const ctx = this.canvas.getContext('webgpu') as GPUCanvasContext | null;
    if (!ctx) throw new Error('Failed to obtain WebGPU context');
    this.ctx = ctx;

    this.ctx.configure({
      device: this.device,
      format: this.format,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_DST,
      alphaMode: 'opaque',
    });

    // Build a simple full-screen blit pipeline
    const shaderCode = `@group(0) @binding(0) var srcTex: texture_2d<f32>;
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

@fragment fn fs_main(in: VOut) -> @location(0) vec4<f32> { return textureSample(srcTex, samp, in.uv); }`;

    const shaderModule = this.device.createShaderModule({ code: shaderCode });
    this.pipeline = this.device.createRenderPipeline({
      layout: 'auto',
      vertex: { module: shaderModule, entryPoint: 'vs_main' },
      fragment: { module: shaderModule, entryPoint: 'fs_main', targets: [{ format: this.format }] },
      primitive: { topology: 'triangle-list' },
    });

    this.layout = this.pipeline.getBindGroupLayout(0);
    this.sampler = this.device.createSampler();
  }

  /** Returns canvas (if caller needs to attach to DOM for debugging) */
  getCanvas(): OffscreenCanvas {
    return this.canvas;
  }

  /** Blit the provided texture onto the internal canvas and return it as an ImageBitmap. Destroys the texture afterwards. */
  blit(texture: GPUTexture): ImageBitmap {
    const encoder = this.device.createCommandEncoder();

    const view = this.ctx.getCurrentTexture().createView();
    const bindGroup = this.device.createBindGroup({
      layout: this.layout,
      entries: [
        { binding: 0, resource: texture.createView() },
        { binding: 1, resource: this.sampler },
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
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.draw(6);
    pass.end();

    this.device.queue.submit([encoder.finish()]);

    const bitmap = this.canvas.transferToImageBitmap();
    return bitmap;
  }
}
