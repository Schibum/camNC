import { beforeAll, describe, expect, it } from "vitest";
import { CornerFinderWorker } from "./cornerFinder.worker";

import imgPathBlurry from "../test_data/chessboard_blurry.jpg";
import imgPathGood from "../test_data/chessboard_good.jpg";
import imgNoChessboard from "../test_data/no_chessboard.jpg";

function loadImage(path: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Failed to load image " + path));
    img.src = path;
  });
}

async function getImageData(
  path: string
): Promise<{ imageData: ArrayBuffer; width: number; height: number }> {
  const img = await loadImage(path);
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  canvas.width = img.width;
  canvas.height = img.height;
  ctx!.drawImage(img, 0, 0);
  const { data, width, height } = ctx!.getImageData(
    0,
    0,
    img.width,
    img.height
  );
  return { imageData: data.buffer, width, height };
}

describe("CornerFinderWorker", () => {
  let worker: CornerFinderWorker;

  beforeAll(async () => {
    worker = new CornerFinderWorker();
    await worker.init();
  });

  it("should find corners in a clear chessboard image", async () => {
    const { imageData, width, height } = await getImageData(imgPathGood);
    const result = await worker.processFrame({
      imageData,
      width,
      height,
      patternWidth: 9, // Update pattern size as needed
      patternHeight: 6,
    });
    expect(result.corners).not.toBeNull();
    expect(Array.isArray(result.corners)).toBe(true);
    expect(result.isBlurry).toBe(false);
    expect((result.corners as any[]).length).toBe(9 * 6);
  });

  it("should return null corners for an image without a chessboard", async () => {
    const { imageData, width, height } = await getImageData(imgNoChessboard);
    const result = await worker.processFrame({
      imageData,
      width,
      height,
      patternWidth: 9,
      patternHeight: 6,
    });
    expect(result.corners).toBeNull();
    expect(result.isBlurry).toBe(false);
  });

  it("should detect blurry chessboard and return isBlurry true", async () => {
    const { imageData, width, height } = await getImageData(imgPathBlurry);
    const result = await worker.processFrame({
      imageData,
      width,
      height,
      patternWidth: 9,
      patternHeight: 6,
    });
    expect(result.corners).toBeNull();
    expect(result.isBlurry).toBe(true);
  });
});
