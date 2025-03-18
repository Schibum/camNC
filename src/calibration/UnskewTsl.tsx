import { CalibrationData, useCalibrationData, useStore, useVideoSrc } from '@/store';
import { useVideoTexture } from '@react-three/drei';
import React, { useEffect, useMemo, useRef } from 'react';
import { type ThreeElements } from '@react-three/fiber';
import * as THREE from 'three';
import { PresentCanvas } from '@/scene/PresentCanvas';
import { initUndistortRectifyMapTyped, Matrix3x3 } from './rectifyMap';

interface UnskewTslProps {
  width?: number;
  height?: number;
}

let lastCalibrationData: CalibrationData | null = null;
let lastWidth: number | null = null;
let lastHeight: number | null = null;
let lastUndistortionMaps: [Float32Array, Float32Array] | null = null;

// Same as calculateUndistortionMaps, but caches the most recent result globally
function calculateUndistortionMapsCached(
  calibrationData: CalibrationData,
  width: number,
  height: number
): [Float32Array, Float32Array] {
  if (
    calibrationData === lastCalibrationData &&
    width === lastWidth &&
    height === lastHeight &&
    lastUndistortionMaps
  ) {
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
function calculateUndistortionMaps(
  calibrationData: CalibrationData,
  width: number,
  height: number
): [Float32Array, Float32Array] {
  // Extract camera matrix and distortion coefficients
  const { calibration_matrix, distortion_coefficients } = calibrationData;

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
    calibration_matrix as Matrix3x3,
    { width, height }
  );
  const endTime = performance.now();
  console.log(`Time taken to calculate undistortion maps: ${endTime - startTime} milliseconds`);

  return [mapXArray, mapYArray];
}

// UndistortMesh component using Three.js Shading
const UndistortMesh = React.forwardRef<
  THREE.Mesh,
  {
    videoTexture: THREE.VideoTexture;
    calibrationData: CalibrationData;
  } & ThreeElements['mesh']
>(({ videoTexture, calibrationData, ...props }, ref) => {
  const meshRef = useRef<THREE.Mesh>(null);

  // Merge refs - use the forwarded ref if available, otherwise use the internal one
  const actualRef = (ref || meshRef) as React.RefObject<THREE.Mesh>;

  // Store video dimensions for calculations
  const videoDimensions = useMemo(() => {
    if (videoTexture && videoTexture.image) {
      return {
        width: videoTexture.image.videoWidth as number,
        height: videoTexture.image.videoHeight as number,
      };
    }
    return { width: 1280, height: 720 }; // Default fallback dimensions
  }, [videoTexture]);

  // Calculate undistortion maps once
  const [mapXTexture, mapYTexture] = useMemo(() => {
    const { width, height } = videoDimensions;

    // Create placeholder textures
    const placeholderX = new THREE.DataTexture(
      new Float32Array(width * height),
      width,
      height,
      THREE.RedFormat,
      THREE.FloatType
    );

    const placeholderY = new THREE.DataTexture(
      new Float32Array(width * height),
      width,
      height,
      THREE.RedFormat,
      THREE.FloatType
    );

    // Calculate maps asynchronously and update textures when ready
    const [mapX, mapY] = calculateUndistortionMapsCached(calibrationData, width, height);
    placeholderX.image.data = mapX;
    placeholderY.image.data = mapY;
    placeholderX.needsUpdate = true;
    placeholderY.needsUpdate = true;

    return [placeholderX, placeholderY];
  }, [videoDimensions, calibrationData]);

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
      float mapX = texture2D(mapXTexture, uv).r;
      float mapY = texture2D(mapYTexture, uv).r;

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
        color = texture2D(videoTexture, remappedUv);
      }

      gl_FragColor = color;
    }
  `;

  // Plane geometry with correct aspect ratio
  const planeGeometry = useMemo(() => {
    return new THREE.PlaneGeometry(videoDimensions.width, videoDimensions.height);
  }, [videoDimensions]);

  return (
    <mesh {...props} ref={actualRef} geometry={planeGeometry}>
      <shaderMaterial
        fragmentShader={fragmentShader}
        vertexShader={vertexShader}
        uniforms={{
          videoTexture: { value: videoTexture },
          mapXTexture: { value: mapXTexture },
          mapYTexture: { value: mapYTexture },
          resolution: { value: new THREE.Vector2(videoDimensions.width, videoDimensions.height) },
        }}
      />
    </mesh>
  );
});

// Add display name for debugging
UndistortMesh.displayName = 'UndistortMesh';

// New UnskewedVideoMesh component to load video texture
export const UnskewedVideoMesh = React.forwardRef<THREE.Mesh, ThreeElements['mesh']>(
  (props, ref) => {
    const calibrationData = useCalibrationData();
    const videoSrc = useVideoSrc();
    const setVideoDimensions = useStore(state => state.setVideoDimensions);
    // Use drei's useVideoTexture hook to load video texture
    const videoTexture = useVideoTexture(videoSrc, {
      crossOrigin: 'anonymous',
      muted: true,
      loop: true,
      start: true,
    });
    useEffect(() => {
      setVideoDimensions([videoTexture.image.videoWidth, videoTexture.image.videoHeight]);
    }, [videoTexture.image.videoWidth, videoTexture.image.videoHeight, setVideoDimensions]);

    return (
      <UndistortMesh
        {...props}
        ref={ref}
        videoTexture={videoTexture}
        calibrationData={calibrationData}
      />
    );
  }
);

// Add display name for debugging
UnskewedVideoMesh.displayName = 'UnskewedVideoMesh';

// Main component
const UnskewTsl: React.FC<UnskewTslProps> = ({ width = 800, height = 600 }) => {
  // Handle missing calibration data - calibrationData is now passed through UnskewedVideoMesh
  const calibrationData = useCalibrationData();
  if (
    !calibrationData ||
    !calibrationData.calibration_matrix ||
    !calibrationData.distortion_coefficients
  ) {
    return (
      <div className="p-4 text-yellow-500 bg-yellow-50 border border-yellow-200 rounded">
        <p>Missing or invalid calibration data</p>
        <p className="text-sm mt-2">Please provide valid camera calibration parameters.</p>
      </div>
    );
  }

  // Handle missing video source - videoSrc is now handled in UnskewedVideoMesh
  const videoSrc = useVideoSrc();
  if (!videoSrc) {
    return (
      <div className="p-4 text-red-500 bg-red-50 border border-red-200 rounded">
        <p>No video source provided</p>
        <p className="text-sm mt-2">Please set a valid video source URL.</p>
      </div>
    );
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
