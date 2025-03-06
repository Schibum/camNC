import { useRef,  useEffect, useCallback } from 'react';
import * as THREE from 'three';
import { CalibrationData, CameraUndistorter } from './undistort';



export function useUndistorter(
  videoRef: React.RefObject<HTMLVideoElement>,
  canvasRef: React.RefObject<HTMLCanvasElement>,
  calibrationData: CalibrationData
) {
  const undistorterRef = useRef<CameraUndistorter | null>(null);
  const undistortedTextureRef = useRef<THREE.Texture | null>(null);

  // Initialize the undistorter
  const initialize = useCallback(async () => {
    if (!videoRef.current || !canvasRef.current) return false;

    try {
      // Initialize the canvas size
      if (videoRef.current.videoWidth && videoRef.current.videoHeight) {
        canvasRef.current.width = videoRef.current.videoWidth;
        canvasRef.current.height = videoRef.current.videoHeight;
      }

      // Create undistorter - now directly using the imported class
      undistorterRef.current = new CameraUndistorter({
        calibrationData,
        videoElement: videoRef.current,
        outputCanvas: canvasRef.current,
        preferWebGPU: true
      });

      // Initialize it
      const success = await undistorterRef.current.initialize();
      if (success) {
        // Create texture from canvas
        undistortedTextureRef.current = new THREE.CanvasTexture(canvasRef.current);
      }
      return success;
    } catch (error) {
      console.error('Error initializing undistorter:', error);
      return false;
    }
  }, [videoRef, canvasRef, calibrationData]);

  // Process a single frame
  const processFrame = useCallback(async () => {
    if (!undistorterRef.current || !undistortedTextureRef.current) return;
    await undistorterRef.current.processFrame();
    undistortedTextureRef.current.needsUpdate = true;
    console.log('Processed frame');
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (undistorterRef.current) {
        undistorterRef.current.dispose();
      }
    };
  }, []);

  return {
    undistortedTextureRef,
    initialize,
    processFrame,
  };
}