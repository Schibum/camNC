import { PresentCanvas } from '@/scene/PresentCanvas';
import { useCalibrationData, useCamResolution, useVideoUrl } from '@/store/store';
import { Text } from '@react-three/drei';
import { type ThreeElements, useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useUnmapTextures } from './CameraShaderMaterial';
import { useCameraTexture } from './useCameraTexture';

// UndistortMesh component using Three.js Shading
export function UnskewedVideoMesh({ ...props }: ThreeElements['mesh']) {
  const videoDimensions = useCamResolution();
  const videoTexture = useCameraTexture();

  const [mapXTexture, mapYTexture] = useUnmapTextures();

  // Create a ref to store the material reference
  const materialRef = useRef<THREE.ShaderMaterial>(null);

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
    // Empty dependency array - create uniforms only once
    []
  );

  // Update uniform values when dependencies change
  useEffect(() => {
    if (materialRef.current) {
      materialRef.current.uniforms.videoTexture.value = videoTexture;
    }
  }, [videoTexture]);

  useEffect(() => {
    if (materialRef.current) {
      materialRef.current.uniforms.mapXTexture.value = mapXTexture;
      materialRef.current.uniforms.mapYTexture.value = mapYTexture;
    }
  }, [mapXTexture, mapYTexture]);

  useEffect(() => {
    if (materialRef.current) {
      materialRef.current.uniforms.resolution.value.set(videoDimensions[0], videoDimensions[1]);
    }
  }, [videoDimensions]);

  return (
    <mesh {...props} geometry={planeGeometry}>
      <shaderMaterial ref={materialRef} fragmentShader={fragmentShader} vertexShader={vertexShader} uniforms={uniforms} />
    </mesh>
  );
}

// Add display name for debugging
UnskewedVideoMesh.displayName = 'UnskewedVideoMesh';

export function UnskewedVideoMeshWithLoading() {
  return (
    // <Suspense fallback={<AnimatedLoadingMesh />}>
    <UnskewedVideoMesh />
    // </Suspense>
  );
}

function AnimatedLoadingMesh() {
  const videoDimensions = useCamResolution();
  const planeGeometry = useMemo(() => new THREE.PlaneGeometry(videoDimensions[0], videoDimensions[1]), [videoDimensions]);
  const spinnerRef = useRef<THREE.Mesh>(null!);
  useFrame(({ clock }) => {
    if (spinnerRef.current) {
      const t = clock.getElapsedTime();
      // rotate around Y so motion is visible from top
      spinnerRef.current.rotation.y = t;
      // cycle through hues for a rainbow effect
      const material = spinnerRef.current.material as THREE.MeshBasicMaterial;
      material.color.setHSL((t * 0.1) % 1, 0.8, 0.5);
    }
  });
  return (
    <group>
      {/* Background plane matching video geometry */}
      <mesh geometry={planeGeometry}>
        <meshBasicMaterial color="black" transparent opacity={0.5} />
      </mesh>
      {/* Tilted and dynamically colored spinner on top of plane */}
      <mesh ref={spinnerRef} position={[0, 0, 0.1]} rotation={[Math.PI / 4, 0, 0]}>
        <torusGeometry
          args={[Math.min(videoDimensions[0], videoDimensions[1]) * 0.1, Math.min(videoDimensions[0], videoDimensions[1]) * 0.02, 16, 100]}
        />
        <meshBasicMaterial color="white" />
      </mesh>
      {/* Loading text */}
      <Text
        position={[0, -videoDimensions[1] * 0.45, 0.1]}
        fontSize={Math.min(videoDimensions[0], videoDimensions[1]) * 0.05}
        color="white">
        Loading video...
      </Text>
    </group>
  );
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
