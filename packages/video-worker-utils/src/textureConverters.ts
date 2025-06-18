import { RawImage } from '@huggingface/transformers';

/**
 * Reads back a GPUTexture containing an `rgba8unorm` image into a `RawImage` that can be
 * consumed by transformers.js pipelines. WebGPU alignment rules require each row to be padded
 * to a 256-byte boundary, so this helper takes care of unpacking the padded buffer into a tightly
 * packed Uint8ClampedArray before constructing the `RawImage`.
 *
 * @param device  The GPUDevice the texture belongs to.
 * @param texture The source GPUTexture in `rgba8unorm` format.
 * @param width   Texture width in pixels.
 * @param height  Texture height in pixels.
 * @returns       A Promise resolving to a `RawImage` containing the RGBA pixel data.
 */
export async function gpuTextureToRawImage(device: GPUDevice, texture: GPUTexture, width: number, height: number): Promise<RawImage> {
  const bytesPerPixel = 4; // rgba8unorm
  const bytesPerRow = Math.ceil((width * bytesPerPixel) / 256) * 256; // WebGPU alignment requirement
  const bufferSize = bytesPerRow * height;

  const readBuffer = device.createBuffer({
    size: bufferSize,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });

  const encoder = device.createCommandEncoder();
  encoder.copyTextureToBuffer(
    { texture },
    { buffer: readBuffer, bytesPerRow, rowsPerImage: height },
    { width, height, depthOrArrayLayers: 1 }
  );
  device.queue.submit([encoder.finish()]);

  await readBuffer.mapAsync(GPUMapMode.READ);
  const mapped = new Uint8Array(readBuffer.getMappedRange());

  // Remove the row padding added to satisfy the 256-byte alignment requirement.
  const packed = new Uint8ClampedArray(width * height * bytesPerPixel);
  for (let y = 0; y < height; y++) {
    const srcStart = y * bytesPerRow;
    const dstStart = y * width * bytesPerPixel;
    packed.set(mapped.subarray(srcStart, srcStart + width * bytesPerPixel), dstStart);
  }

  readBuffer.unmap();
  readBuffer.destroy();

  return new RawImage(packed, width, height, 4);
}

/**
 * Converts a `RawImage` (RGBA) produced by transformers.js back into a WebGPU `GPUTexture` so that
 * subsequent GPU-based steps can consume it. Internally it:
 * 1. Converts the RawImage to an `ImageData` instance.
 * 2. Creates an `ImageBitmap` from that `ImageData` (required by `copyExternalImageToTexture`).
 * 3. Copies the bitmap into a newly created GPUTexture (format `rgba8unorm`).
 *
 * @param device  The GPUDevice that should own the resulting texture.
 * @param raw     The source RawImage.
 * @param usage   Optional extra usage flags to OR-in with the default set.
 * @returns       A Promise resolving to a freshly created GPUTexture containing the image.
 */
export async function rawImageToGPUTexture(device: GPUDevice, raw: RawImage, usage: GPUTextureUsageFlags = 0): Promise<GPUTexture> {
  const rgba = raw.rgba();
  const width = rgba.width;
  const height = rgba.height;

  const imageData = new ImageData(new Uint8ClampedArray(rgba.data), width, height);
  const bitmap = await createImageBitmap(imageData);

  const texture = device.createTexture({
    size: [width, height],
    format: 'rgba8unorm',
    usage:
      GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC | usage,
  });

  device.queue.copyExternalImageToTexture({ source: bitmap }, { texture }, [width, height]);

  bitmap.close();
  return texture;
}
