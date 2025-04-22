import { getCanvasBlob } from "../store/calibrationStore"; // Import helper if needed or redefine it here

/**
 * Creates an image Blob from ImageData.
 * @param source The ImageData to convert.
 * @param type The image MIME type (e.g., 'image/jpeg').
 * @param quality The image quality (for lossy formats like 'image/jpeg').
 * @returns A Promise resolving to the Blob.
 * @throws Error if creation fails.
 */
export async function createImageBlob(
  source: ImageData,
  type: string = "image/jpeg",
  quality: number = 0.9
): Promise<Blob> {
  const canvas = document.createElement("canvas");
  const width = source.width;
  const height = source.height;

  if (width === 0 || height === 0) {
    throw new Error("[createImageBlob] Invalid dimensions in ImageData.");
  }

  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");

  if (!ctx) {
    throw new Error("[createImageBlob] Could not get canvas context.");
  }

  ctx.putImageData(source, 0, 0);

  // Use the imported getCanvasBlob helper
  const blob = await getCanvasBlob(canvas, type, quality);

  if (!blob) {
    throw new Error(
      "[createImageBlob] Failed to create blob from canvas (getCanvasBlob returned null)."
    );
  }

  return blob;
}
