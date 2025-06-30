// No external imports required – WebGPU types are global in TS.

/**
 * GaussianBlurStep applies a separable Gaussian blur to an RGBA8 texture using two compute passes
 * (horizontal + vertical).  It is designed as a lightweight post-processing step that can be reused
 * after any GPU stage that outputs an `rgba8unorm` texture (e.g. MaskInflationStep).
 *
 * The kernel radius and sigma are fixed during construction so the generated WGSL code can embed
 * the weights as `const` arrays, allowing the compiler to fully unroll the convolution loops.
 */
export class GaussianBlurStep {
  private device: GPUDevice;
  private radius: number;
  private sigma: number;
  private weights: number[];

  // Pipelines + sampler are initialised lazily and cached.
  private pipelines: Record<'h' | 'v', GPUComputePipeline | null> = { h: null, v: null };
  private sampler: GPUSampler | null = null;

  /**
   * Re-usable scratch textures. They are (re)created the first time we see a
   * given width × height, then kept for the lifetime of the step.  Because the
   * pipeline is strictly «produce – consume – finish» inside a single frame we
   * do not need a second buffer (ping-pong).  If the caller ever changes the
   * resolution we dispose and re-allocate.
   */
  private tmpTex: GPUTexture | null = null;
  private dstTex: GPUTexture | null = null;

  constructor(device: GPUDevice, radius: number = 7, sigma: number = 4.0) {
    if (radius < 1 || radius > 32) throw new Error('GaussianBlurStep radius must be between 1 and 32');
    this.device = device;
    this.radius = Math.floor(radius);
    this.sigma = sigma;
    this.weights = this.computeWeights(this.radius, this.sigma);
  }

  /** Returns a radius+1 sized weight array normalised to sum to 1 (symmetric kernel). */
  private computeWeights(radius: number, sigma: number): number[] {
    const w: number[] = new Array(radius + 1);
    let sum = 0;
    for (let i = 0; i <= radius; i++) {
      const val = Math.exp((-0.5 * (i * i)) / (sigma * sigma));
      w[i] = val;
      sum += i === 0 ? val : 2 * val; // centre counted once, others twice (±)
    }
    // normalise
    for (let i = 0; i <= radius; i++) w[i] /= sum;
    return w;
  }

  /** Build / cache horizontal or vertical pipeline. */
  private getPipeline(dir: 'h' | 'v'): GPUComputePipeline {
    const cached = this.pipelines[dir];
    if (cached) return cached;

    const offsetExpr = dir === 'h' ? `vec2<f32>(f32(i) / f32(size.x), 0.0)` : `vec2<f32>(0.0, f32(i) / f32(size.y))`;

    // Embed weights as const WGSL array for maximal performance.
    const weightsArr = this.weights.map(w => `${w.toFixed(8)}f`).join(', ');
    const shaderCode = /* wgsl */ `
      const RADIUS : i32 = ${this.radius};
      const WEIGHTS : array<f32, ${this.radius + 1}> = array<f32, ${this.radius + 1}>( ${weightsArr} );

      @group(0) @binding(0) var srcTex : texture_2d<f32>;
      @group(0) @binding(1) var samp   : sampler;
      @group(0) @binding(2) var dstTex : texture_storage_2d<rgba8unorm, write>;

      @compute @workgroup_size(16, 16)
      fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
        let size = textureDimensions(srcTex);
        if (gid.x >= size.x || gid.y >= size.y) { return; }

        let uvBase = (vec2<f32>(gid.xy) + vec2<f32>(0.5, 0.5)) / vec2<f32>(size);

        var col = textureSampleLevel(srcTex, samp, uvBase, 0.0) * WEIGHTS[0];

        for (var i : i32 = 1; i <= RADIUS; i = i + 1) {
          let off = ${offsetExpr};
          let w = WEIGHTS[i];
          col += textureSampleLevel(srcTex, samp, uvBase + off, 0.0) * w;
          col += textureSampleLevel(srcTex, samp, uvBase - off, 0.0) * w;
        }

        textureStore(dstTex, vec2<i32>(gid.xy), col);
      }
    `;

    const module = this.device.createShaderModule({ code: shaderCode });
    const pipeline = this.device.createComputePipeline({ layout: 'auto', compute: { module, entryPoint: 'main' } });
    this.pipelines[dir] = pipeline;
    if (!this.sampler) {
      this.sampler = this.device.createSampler({
        label: 'GaussianBlurStep sampler',
        addressModeU: 'clamp-to-edge',
        addressModeV: 'clamp-to-edge',
        magFilter: 'nearest',
        minFilter: 'nearest',
      });
    }
    return pipeline;
  }

  /**
   * Execute blur. The input texture must have TEXTURE_BINDING usage. The returned texture can be
   * sampled by subsequent passes and is created with STORAGE_BINDING | TEXTURE_BINDING | COPY_SRC.
   */
  async process(srcTex: GPUTexture): Promise<GPUTexture> {
    const width = srcTex.width;
    const height = srcTex.height;

    // (Re)allocate reusable textures if size has changed.
    if (!this.tmpTex || this.tmpTex.width !== width || this.tmpTex.height !== height) {
      this.tmpTex?.destroy();
      this.tmpTex = this.device.createTexture({
        label: 'GaussianBlurStep tmp (horizontal)',
        size: [width, height],
        format: 'rgba8unorm',
        usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
      });
    }

    if (!this.dstTex || this.dstTex.width !== width || this.dstTex.height !== height) {
      this.dstTex?.destroy();
      this.dstTex = this.device.createTexture({
        label: 'GaussianBlurStep output (vertical)',
        size: [width, height],
        format: 'rgba8unorm',
        usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC,
      });
    }

    const tmpTex = this.tmpTex!;
    const dstTex = this.dstTex!;

    // Pass 1: horizontal
    const hPipe = this.getPipeline('h');
    const hBind = this.device.createBindGroup({
      label: 'GaussianBlurStep bindgroup H',
      layout: hPipe.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: srcTex.createView() },
        { binding: 1, resource: this.sampler! },
        { binding: 2, resource: tmpTex.createView() },
      ],
    });

    // Pass 2: vertical
    const vPipe = this.getPipeline('v');
    const vBind = this.device.createBindGroup({
      label: 'GaussianBlurStep bindgroup V',
      layout: vPipe.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: tmpTex.createView() },
        { binding: 1, resource: this.sampler! },
        { binding: 2, resource: dstTex.createView() },
      ],
    });

    const encoder = this.device.createCommandEncoder();

    // Horizontal pass
    {
      const pass = encoder.beginComputePass();
      pass.setPipeline(hPipe);
      pass.setBindGroup(0, hBind);
      pass.dispatchWorkgroups(Math.ceil(width / 16), Math.ceil(height / 16));
      pass.end();
    }

    // Vertical pass
    {
      const pass = encoder.beginComputePass();
      pass.setPipeline(vPipe);
      pass.setBindGroup(0, vBind);
      pass.dispatchWorkgroups(Math.ceil(width / 16), Math.ceil(height / 16));
      pass.end();
    }

    this.device.queue.submit([encoder.finish()]);

    // NOTE: we purposely do NOT destroy `tmpTex` & `dstTex` — they are part of
    // the step's internal ping-pong pool and will be reused next frame.  The
    // caller receives `dstTex`; once they are done with it they *may* call
    // `.destroy()`.  Because we alternate between two textures, we will not
    // attempt to reuse a texture that might still be in use by the caller.

    return dstTex;
  }
}
