import { PresentCanvas } from '@/scene/PresentCanvas';
import { useCalibrationData, useCamResolution, useVideoUrl } from '@/store/store';
import { type ThreeElements } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { useUnmapTextures } from './CameraShaderMaterial';
import { useCameraTexture } from './useCameraTexture';

// UndistortMesh component using Three.js Shading
export function UnskewedVideoMesh({ ...props }: ThreeElements['mesh']) {
  const videoDimensions = useCamResolution();
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
    const plane = new THREE.PlaneGeometry(videoDimensions[0], videoDimensions[1]);
    plane.translate(videoDimensions[0] / 2, -videoDimensions[1] / 2, 0);
    plane.rotateX(Math.PI);
    return plane;
  }, [videoDimensions]);

  // Create stable uniforms object that won't be recreated
  const uniforms = useMemo(
    () => ({
      videoTexture: { value: videoTexture },
      mapXTexture: { value: mapXTexture },
      mapYTexture: { value: mapYTexture },
      resolution: { value: new THREE.Vector2(videoDimensions[0], videoDimensions[1]) },
    }),
    [videoTexture, mapXTexture, mapYTexture, videoDimensions]
  );

  // Update uniform values when dependencies change
  useEffect(() => {
    uniforms.videoTexture.value = videoTexture;
    uniforms.mapXTexture.value = mapXTexture;
    uniforms.mapYTexture.value = mapYTexture;
    uniforms.resolution.value.set(videoDimensions[0], videoDimensions[1]);
  }, [videoTexture, mapXTexture, mapYTexture, videoDimensions, uniforms]);

  return (
    <mesh {...props} geometry={planeGeometry}>
      <shaderMaterial fragmentShader={fragmentShader} vertexShader={vertexShader} uniforms={uniforms} />
    </mesh>
  );
}

// Add display name for debugging
UnskewedVideoMesh.displayName = 'UnskewedVideoMesh';

export function UnskewedVideoMeshWithLoading() {
  return <UnskewedVideoMesh />;
}

// Main component
function UnskewTsl() {
  // Handle missing calibration data - calibrationData is now passed through UnskewedVideoMesh
  const calibrationData = useCalibrationData();
  // Handle missing video source - videoSrc is now handled in UnskewedVideoMesh
  const videoSrc = useVideoUrl();
  if (!calibrationData || !calibrationData.calibration_matrix || !calibrationData.distortion_coefficients || !videoSrc) {
    throw new Error('Missing calibration data or video source');
  }

  return (
    <div className="h-full w-full">
      <PresentCanvas>
        <UnskewedVideoMesh
          onClick={ev => {
            console.log('clicked', ev.point);
          }}
        />
        {/* <axesHelper args={[3000]} translateZ={100} /> */}
      </PresentCanvas>
    </div>
  );
}

export default UnskewTsl;
