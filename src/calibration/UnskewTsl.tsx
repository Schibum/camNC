import { CalibrationData, useCalibrationData, useVideoSrc, useVideoDimensions } from '@/store';
import React, { useMemo } from 'react';
import { type ThreeElements } from '@react-three/fiber';
import * as THREE from 'three';
import { PresentCanvas } from '@/scene/PresentCanvas';
import { initUndistortRectifyMapTyped, Matrix3x3 } from './rectifyMap';
import { useUnmapTextures } from './CameraShaderMaterial';
import { useCameraTexture } from './useCameraTexture';

interface UnskewTslProps {
  width?: number;
  height?: number;
}

let lastCalibrationData: CalibrationData | null = null;
let lastWidth: number | null = null;
let lastHeight: number | null = null;
let lastUndistortionMaps: [Float32Array, Float32Array] | null = null;

// Same as calculateUndistortionMaps, but caches the most recent result globally
export function calculateUndistortionMapsCached(
  calibrationData: CalibrationData,
  width: number,
  height: number
): [Float32Array, Float32Array] {
  if (calibrationData === lastCalibrationData && width === lastWidth && height === lastHeight && lastUndistortionMaps) {
    return lastUndistortionMaps;
  }
  lastCalibrationData = calibrationData;
  lastWidth = width;
  lastHeight = height;
  lastUndistortionMaps = calculateUndistortionMaps(calibrationData, width, height);
  return lastUndistortionMaps;
}

/**
 * Calculate the undistortion maps from OpenCV camera parameters
 * @param calibrationData Camera calibration data with intrinsic matrix and distortion coefficients
 * @param width Image width
 * @param height Image height
 * @returns {Float32Array[]} Arrays for X and Y undistortion maps
 */
function calculateUndistortionMaps(calibrationData: CalibrationData, width: number, height: number): [Float32Array, Float32Array] {
  // Extract camera matrix and distortion coefficients
  const { calibration_matrix, distortion_coefficients, new_camera_matrix } = calibrationData;

  const R: Matrix3x3 = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];
  const startTime = performance.now();

  const { map1: mapXArray, map2: mapYArray } = initUndistortRectifyMapTyped(
    calibration_matrix as Matrix3x3,
    distortion_coefficients[0],
    R,
    new_camera_matrix,
    { width, height }
  );
  const endTime = performance.now();
  console.log(`Time taken to calculate undistortion maps: ${endTime - startTime} milliseconds`);

  return [mapXArray, mapYArray];
}

// UndistortMesh component using Three.js Shading
export function UnskewedVideoMesh({ ...props }: ThreeElements['mesh']) {
  const videoDimensions = useVideoDimensions();
  const videoTexture = useCameraTexture();

  const [mapXTexture, mapYTexture] = useUnmapTextures();

  // Basic GLSL shader for undistortion
  const vertexShader = /* glsl */ `
    varying vec2 vUv;

    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `;

  const fragmentShader = /* glsl */ `
    // Basic GLSL fragment shader for undistortion
    uniform sampler2D videoTexture;
    uniform sampler2D mapXTexture;
    uniform sampler2D mapYTexture;
    uniform vec2 resolution;

    varying vec2 vUv;

    void main() {
      // Get the normalized (0-1) coordinates
      vec2 uv = vUv;

      // Get the remapped coordinates from the map textures
      float mapX = texture2D(mapXTexture, vec2(uv.x, 1.0 - uv.y)).r;
      float mapY = texture2D(mapYTexture, vec2(uv.x, 1.0 - uv.y)).r;

      // Convert to normalized UV coordinates
      vec2 remappedUv = vec2(
        mapX / resolution.x,
        mapY / resolution.y
      );

      // Sample the video texture at the remapped coordinates
      // Check if coordinates are within the valid range (0-1)
      vec4 color = vec4(0.0, 0.0, 0.0, 1.0);
      if (remappedUv.x >= 0.0 && remappedUv.x <= 1.0 &&
          remappedUv.y >= 0.0 && remappedUv.y <= 1.0) {
        color = texture2D(videoTexture, vec2( remappedUv.x, 1.0 - remappedUv.y));
      }

      gl_FragColor = color;
    }
  `;

  // Plane geometry with correct aspect ratio
  const planeGeometry = useMemo(() => {
    return new THREE.PlaneGeometry(videoDimensions[0], videoDimensions[1]);
  }, [videoDimensions]);

  return (
    <mesh {...props} geometry={planeGeometry}>
      <shaderMaterial
        fragmentShader={fragmentShader}
        vertexShader={vertexShader}
        uniforms={{
          videoTexture: { value: videoTexture },
          mapXTexture: { value: mapXTexture },
          mapYTexture: { value: mapYTexture },
          resolution: { value: new THREE.Vector2(videoDimensions[0], videoDimensions[1]) },
        }}
      />
    </mesh>
  );
}

// Add display name for debugging
UnskewedVideoMesh.displayName = 'UnskewedVideoMesh';

// Main component
const UnskewTsl: React.FC<UnskewTslProps> = ({ width = 800, height = 600 }) => {
  // Handle missing calibration data - calibrationData is now passed through UnskewedVideoMesh
  const calibrationData = useCalibrationData();
  // Handle missing video source - videoSrc is now handled in UnskewedVideoMesh
  const videoSrc = useVideoSrc();
  if (!calibrationData || !calibrationData.calibration_matrix || !calibrationData.distortion_coefficients || !videoSrc) {
    throw new Error('Missing calibration data or video source');
  }

  return (
    <div style={{ width, height }}>
      <PresentCanvas>
        <UnskewedVideoMesh />
      </PresentCanvas>
    </div>
  );
};

export default UnskewTsl;
