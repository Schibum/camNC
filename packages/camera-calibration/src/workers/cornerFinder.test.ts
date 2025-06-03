import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  StreamCornerFinderWorkerAPI,
  type FrameEvent,
} from "./streamCornerFinder.worker";

import * as Comlink from "comlink";
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

/**
 * Creates a ReadableStream<VideoFrame> from a single image for testing
 */
async function createVideoFrameStreamFromImage(
  imagePath: string
): Promise<ReadableStream<VideoFrame>> {
  const img = await loadImage(imagePath);
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not get canvas context");

  canvas.width = img.width;
  canvas.height = img.height;
  ctx.drawImage(img, 0, 0);

  // Create a VideoFrame from the canvas
  const videoFrame = new VideoFrame(canvas, {
    timestamp: 0,
  });

  // Create a readable stream that emits this single frame
  return new ReadableStream<VideoFrame>({
    start(controller) {
      controller.enqueue(videoFrame);
      controller.close();
    },
  });
}

/**
 * Helper to test worker processing with a single image and expected result
 */
async function testWorkerWithImage(
  workerProxy: Comlink.Remote<StreamCornerFinderWorkerAPI>,
  imagePath: string,
  expectedResult: FrameEvent["result"],
  additionalValidation?: (data: FrameEvent) => void
): Promise<void> {
  const stream = await createVideoFrameStreamFromImage(imagePath);
  const img = await loadImage(imagePath);

  return new Promise<void>(async (resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Test timeout")), 10000);

    const onFrameProcessed = (data: FrameEvent) => {
      clearTimeout(timeout);
      try {
        expect(data.result).toBe(expectedResult);
        if (additionalValidation) {
          additionalValidation(data);
        }
        resolve();
      } catch (error) {
        reject(error);
      }
    };

    await workerProxy.init(
      Comlink.transfer(stream, [stream]),
      { width: 9, height: 6 },
      { width: img.width, height: img.height },
      Comlink.proxy(onFrameProcessed)
    );

    await workerProxy.start();
  });
}

describe("StreamCornerFinderWorker", () => {
  let worker: Worker;
  let workerProxy: Comlink.Remote<StreamCornerFinderWorkerAPI>;

  beforeEach(async () => {
    worker = new Worker(
      new URL("./streamCornerFinder.worker.ts", import.meta.url),
      {
        type: "module",
      }
    );
    workerProxy = Comlink.wrap<StreamCornerFinderWorkerAPI>(worker);
  });

  afterEach(() => {
    worker.terminate();
  });

  it("should find corners in a clear chessboard image", async () => {
    await testWorkerWithImage(workerProxy, imgPathGood, "capture", (data) => {
      if (data.result === "capture") {
        expect(data.corners).not.toBeNull();
        expect(Array.isArray(data.corners)).toBe(true);
        expect(data.corners.length).toBe(9 * 6);
      }
    });
  });

  it("should return null corners for an image without a chessboard", async () => {
    await testWorkerWithImage(workerProxy, imgNoChessboard, "not_unique");
  });

  it("should detect blurry chessboard and return isBlurry true", async () => {
    await testWorkerWithImage(workerProxy, imgPathBlurry, "blurry");
  });
});
