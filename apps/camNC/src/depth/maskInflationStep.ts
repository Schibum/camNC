import { makeShaderDataDefinitions, makeStructuredView } from 'webgpu-utils';
import { DepthOutput } from './depthPipeline';
import { rawImageToGPUTexture } from './textureConverters';

/**
 * MaskInflationStep converts a depth texture + threshold value into a dilated binary mask.
 * The mask is a single-channel RGBA8 texture where 1.0 (white) marks foreground pixels and
 * 0.0 (black) marks background / masked-out pixels.
 */
export class MaskInflationStep {
  private device: GPUDevice;
  private margin: number;
  private pipeline: GPUComputePipeline | null = null;
  private sampler: GPUSampler | null = null;

  /**
   * @param margin Number of screen-space pixels by which the mask should be inflated (defaults to 10).
   */
  constructor(device: GPUDevice, margin: number = 10) {
    this.device = device;
    this.margin = Math.max(0, Math.floor(margin));
  }

  private getPipeline(shaderCode: string): GPUComputePipeline {
    if (this.pipeline) return this.pipeline;
    const module = this.device.createShaderModule({ code: shaderCode });
    this.pipeline = this.device.createComputePipeline({ layout: 'auto', compute: { module, entryPoint: 'main' } });
    this.sampler = this.device.createSampler({ label: 'MaskInflationStep sampler' });
    return this.pipeline;
  }

  async process({ depth, threshold }: DepthOutput): Promise<GPUTexture> {
    // Upload depth map to GPU.
    const depthTex = await rawImageToGPUTexture(this.device, depth);
    depthTex.label = 'MaskInflationStep depth texture';

    const width = depth.width;
    const height = depth.height;

    // Destination mask texture (RGBA8 so downstream steps can sample as f32).
    const maskTex = this.device.createTexture({
      label: 'MaskInflationStep mask texture',
      size: [width, height],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC,
    });

    // Build WGSL shader with embedded constant margin.
    const shaderCode = /* wgsl */ `
struct ThresholdParams {
  threshold : f32,
};

@group(0) @binding(0) var depthTex : texture_2d<f32>;
@group(0) @binding(1) var samp      : sampler;
@group(0) @binding(2) var<uniform> params : ThresholdParams;
@group(0) @binding(3) var maskTex   : texture_storage_2d<rgba8unorm, write>;

const MARGIN : i32 = ${this.margin}; // pixels

@compute @workgroup_size(8,8)
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
  let size = textureDimensions(depthTex);
  if (gid.x >= size.x || gid.y >= size.y) { return; }

  // Sample depth at current pixel.
  let uv = (vec2<f32>(vec2<u32>(gid.xy)) + vec2<f32>(0.5,0.5)) / vec2<f32>(vec2<u32>(size));
  var isForeground = textureSampleLevel(depthTex, samp, uv, 0.0).r <= params.threshold;

  // If foreground, test neighbours – if any neighbour is background, mark current pixel as background (edge inflation).
  if (isForeground) {
    for (var dy : i32 = -MARGIN; dy <= MARGIN && isForeground; dy = dy + 1) {
      for (var dx : i32 = -MARGIN; dx <= MARGIN && isForeground; dx = dx + 1) {
        if (dx == 0 && dy == 0) { continue; }
        let nx : i32 = i32(gid.x) + dx;
        let ny : i32 = i32(gid.y) + dy;
        if (nx < 0 || ny < 0 || nx >= i32(size.x) || ny >= i32(size.y)) { continue; }
        let nuv = (vec2<f32>(vec2<i32>(nx, ny)) + vec2<f32>(0.5,0.5)) / vec2<f32>(vec2<u32>(size));
        let neighbourDepth = textureSampleLevel(depthTex, samp, nuv, 0.0).r;
        if (neighbourDepth > params.threshold) {
          isForeground = false;
        }
      }
    }
  }

  let outVal = select(vec4<f32>(0.0,0.0,0.0,1.0), vec4<f32>(1.0,1.0,1.0,1.0), isForeground);
  textureStore(maskTex, vec2<i32>(i32(gid.x), i32(gid.y)), outVal);
}`;

    const defs = makeShaderDataDefinitions(shaderCode);
    const thresholdView = makeStructuredView(defs.uniforms.params);
    thresholdView.set({ threshold });

    const uniformBuffer = this.device.createBuffer({
      label: 'MaskInflationStep threshold uniform',
      size: thresholdView.arrayBuffer.byteLength,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(uniformBuffer, 0, thresholdView.arrayBuffer);

    const pipeline = this.getPipeline(shaderCode);
    const bindGroup = this.device.createBindGroup({
      label: 'MaskInflationStep bind group',
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: depthTex.createView() },
        { binding: 1, resource: this.sampler! },
        { binding: 2, resource: { buffer: uniformBuffer } },
        { binding: 3, resource: maskTex.createView() },
      ],
    });

    const encoder = this.device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(Math.ceil(width / 8), Math.ceil(height / 8));
    pass.end();
    this.device.queue.submit([encoder.finish()]);

    // Clean up temp resources.
    depthTex.destroy();
    uniformBuffer.destroy();

    return maskTex;
  }
}
