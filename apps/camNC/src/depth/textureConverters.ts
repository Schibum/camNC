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
  const packed = await _readTextureToPackedUint8ClampedArray(device, texture, width, height, 4);
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
  // Detect channel count to decide the upload path.
  // transformers.js RawImage exposes a `channels` property. Fallback to 4 if unavailable.
  const channels: number = (raw as any).channels ?? 4;

  // Access common width / height helpers – these are always present on RawImage instances.
  const width: number = (raw as any).width;
  const height: number = (raw as any).height;

  // Fast-path for single-channel (grayscale) images → create `r8unorm` texture.
  if (channels === 1) {
    const bytesPerPixel = 1;
    const bytesPerRow = Math.ceil((width * bytesPerPixel) / 256) * 256; // WebGPU alignment requirement
    // const bufferSize = bytesPerRow * height;

    // Ensure we have a Uint8Array view of the data.
    const src = raw.data;

    if (bytesPerRow !== width * bytesPerPixel) {
      throw new Error('bytesPerRow !== width * bytesPerPixel');
    }
    // // For rows that need padding to meet the 256-byte alignment constraint, copy into a staging buffer.
    // const padded =
    //   bytesPerRow === width * bytesPerPixel
    //     ? src // No padding needed – can upload directly.
    //     : (() => {
    //         const tmp = new Uint8Array(bufferSize);
    //         for (let y = 0; y < height; y++) {
    //           const srcStart = y * width;
    //           const dstStart = y * bytesPerRow;
    //           tmp.set(src.subarray(srcStart, srcStart + width), dstStart);
    //         }
    //         return tmp;
    //       })();

    const texture = device.createTexture({
      size: [width, height],
      format: 'r8unorm',
      usage:
        GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC | usage,
    });

    device.queue.writeTexture({ texture }, src, { bytesPerRow, rowsPerImage: height }, { width, height, depthOrArrayLayers: 1 });

    return texture;
  }

  // ===== Fallback: 3- or 4-channel image – convert to RGBA and upload via ImageBitmap (existing path) =====
  const rgba = raw.rgba();
  const imageData = new ImageData(new Uint8ClampedArray(rgba.data), rgba.width, rgba.height);
  const bitmap = await createImageBitmap(imageData);

  const texture = device.createTexture({
    size: [rgba.width, rgba.height],
    format: 'rgba8unorm',
    usage:
      GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC | usage,
  });

  device.queue.copyExternalImageToTexture({ source: bitmap }, { texture }, [rgba.width, rgba.height]);
  bitmap.close();
  return texture;
}

// Internal helper: reads a GPUTexture into a tightly packed Uint8ClampedArray (no row padding)
async function _readTextureToPackedUint8ClampedArray(
  device: GPUDevice,
  texture: GPUTexture,
  width: number,
  height: number,
  bytesPerPixel: number
): Promise<Uint8ClampedArray> {
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

  // Remove row padding.
  const packed = new Uint8ClampedArray(width * height * bytesPerPixel);
  for (let y = 0; y < height; y++) {
    const srcStart = y * bytesPerRow;
    const dstStart = y * width * bytesPerPixel;
    packed.set(mapped.subarray(srcStart, srcStart + width * bytesPerPixel), dstStart);
  }

  readBuffer.unmap();
  readBuffer.destroy();

  return packed;
}

export async function gpuTextureToImageBitmap(device: GPUDevice, texture: GPUTexture, width: number, height: number): Promise<ImageBitmap> {
  const packed = await _readTextureToPackedUint8ClampedArray(device, texture, width, height, 4);
  const imageData = new ImageData(packed, width, height);
  const bitmap = await createImageBitmap(imageData);
  return bitmap;
}
