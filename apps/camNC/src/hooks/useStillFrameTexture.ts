import { useCallback } from 'react';

import { useCameraTexture } from '@/calibration/useCameraTexture';
import { useMemo } from 'react';
import { CanvasTexture } from 'three';
/**
 * Averages a specified number of frames from a video element.
 *
 * @param videoElement The HTMLVideoElement to capture frames from.
 * @param targetFrameCount The number of frames to average.
 * @returns A Promise that resolves with the averaged ImageData.
 */
export function averageVideoFrames(videoElement: HTMLVideoElement, targetFrameCount: number = 25): Promise<ImageData> {
  return new Promise((resolve, reject) => {
    if (!videoElement.videoWidth || !videoElement.videoHeight) {
      throw new Error('Video dimensions are not available. Ensure the video has loaded metadata.');
    }
    if (targetFrameCount <= 0) {
      throw new Error('targetFrameCount must be positive.');
    }

    const offCanvas = document.createElement('canvas');
    offCanvas.width = videoElement.videoWidth;
    offCanvas.height = videoElement.videoHeight;
    const offCtx = offCanvas.getContext('2d', { willReadFrequently: true }); // Optimize for frequent readback

    if (!offCtx) {
      throw new Error('Could not get 2D context for offscreen canvas');
    }

    let frameCount = 0;
    let runningAverage: Float32Array | null = null;

    const processFrame = () => {
      // Ensure we don't exceed the target frame count due to async callbacks
      if (frameCount >= targetFrameCount) {
        // finishAveraging should have already been called, but guard just in case
        return;
      }

      // Draw frame and get data
      offCtx.drawImage(videoElement, 0, 0, offCanvas.width, offCanvas.height);
      let frameData: ImageData;
      try {
        frameData = offCtx.getImageData(0, 0, offCanvas.width, offCanvas.height);
      } catch (error) {
        // Handle potential security errors (e.g., tainted canvas)
        reject(new Error(`Could not get image data: ${error}`));
        return;
      }
      const data = frameData.data;

      // Initialize or update average
      if (!runningAverage) {
        runningAverage = new Float32Array(data.length);
        // Initialize with the first frame's data
        for (let i = 0; i < data.length; i++) {
          runningAverage[i] = data[i];
        }
        frameCount = 1;
      } else {
        frameCount++;
        // Incremental update: avg_n = avg_{n-1} + (sample_n - avg_{n-1}) / n
        for (let i = 0; i < data.length; i++) {
          runningAverage[i] += (data[i] - runningAverage[i]) / frameCount;
        }
      }

      // Check if done
      if (frameCount >= targetFrameCount) {
        finishAveraging();
      } else {
        // Request next frame
        videoElement.requestVideoFrameCallback(processFrame);
      }
    };

    const finishAveraging = () => {
      if (!runningAverage) {
        // Should not happen if targetFrameCount > 0
        reject(new Error('Averaging finished unexpectedly without data.'));
        return;
      }
      // Convert float average back to clamped byte array
      const finalDataArray = new Uint8ClampedArray(runningAverage.length);
      for (let i = 0; i < runningAverage.length; i++) {
        finalDataArray[i] = Math.round(Math.max(0, Math.min(255, runningAverage[i])));
      }

      const finalImageData = new ImageData(finalDataArray, offCanvas.width, offCanvas.height);
      resolve(finalImageData);
    };

    // Start the process
    videoElement.requestVideoFrameCallback(processFrame);
  });
}

/**
 * Returns a texture that averages the last 25 frames of the camera video.
 * @returns A tuple containing the texture and an update function to start averaging.
 */
export function useStillFrameTexture() {
  const camTexture = useCameraTexture();

  const [texture, ctx] = useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = camTexture.image.videoWidth;
    canvas.height = camTexture.image.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Failed to get 2d context');
    return [new CanvasTexture(canvas), ctx];
  }, [camTexture.image]);

  const update = useCallback(async () => {
    ctx.drawImage(camTexture.image, 0, 0);
    texture.needsUpdate = true;
    const imageData = await averageVideoFrames(camTexture.image, 25);
    ctx.putImageData(imageData, 0, 0);
    texture.needsUpdate = true;
  }, [camTexture.image, ctx, texture]);
  return [texture, update] as const;
}
