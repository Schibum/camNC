import { PresentCanvas } from '@/scene/PresentCanvas';
import { CalibrationData, useCalibrationData, useStore, useVideoSrc } from '@/store';
import { useVideoTexture } from '@react-three/drei';
import { type ThreeElements } from '@react-three/fiber';
import React, { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { calculateUndistortionMapsCached } from './UnskewTsl';

// UndistortMesh component using Three.js Shading
const UndistortMesh = React.forwardRef<
  THREE.Mesh,
  {
    videoTexture: THREE.VideoTexture;
    calibrationData: CalibrationData;
  } & ThreeElements['mesh']
>(({ videoTexture, calibrationData, ...props }, ref) => {
  const R = [
    [-0.97566293, 0.21532301, 0.04144691],
    [0.11512022, 0.66386443, -0.73893934],
    [-0.18662577, -0.71618435, -0.67249595],
  ];
  const t = [94.45499514, -537.61861834, 1674.35779694];

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
    const placeholderX = new THREE.DataTexture(new Float32Array(width * height), width, height, THREE.RedFormat, THREE.FloatType);

    const placeholderY = new THREE.DataTexture(new Float32Array(width * height), width, height, THREE.RedFormat, THREE.FloatType);

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
export const UnprojectVideoMesh = React.forwardRef<THREE.Mesh, ThreeElements['mesh']>((props, ref) => {
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

  return <UndistortMesh {...props} ref={ref} videoTexture={videoTexture} calibrationData={calibrationData} />;
});

// Add display name for debugging
UnprojectVideoMesh.displayName = 'UnprojectVideoMesh';

export function UnprojectTsl() {
  // Handle missing calibration data - calibrationData is now passed through UnskewedVideoMesh
  const calibrationData = useCalibrationData();
  // Handle missing video source - videoSrc is now handled in UnskewedVideoMesh
  const videoSrc = useVideoSrc();
  if (!calibrationData || !calibrationData.calibration_matrix || !calibrationData.distortion_coefficients || !videoSrc) {
    throw new Error('Missing calibration data or video source');
  }

  return (
    <PresentCanvas>
      <UnprojectVideoMesh />
    </PresentCanvas>
  );
}
