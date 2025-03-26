import { PresentCanvas } from '@/scene/PresentCanvas';
import { CalibrationData, useCalibrationData, useMachineSize, useNewCameraMatrix, useStore, useVideoSrc } from '@/store';
import { useVideoTexture } from '@react-three/drei';
import { type ThreeElements } from '@react-three/fiber';
import React, { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { calculateUndistortionMapsCached } from './UnskewTsl';

const UndistortMesh = React.forwardRef<
  THREE.Mesh,
  {
    videoTexture: THREE.VideoTexture;
    calibrationData: CalibrationData;
    // Object height (Z offset in world units, e.g. mm) to be applied
    objectHeight?: number;
  } & ThreeElements['mesh']
>(({ videoTexture, calibrationData, objectHeight = 0.0, ...props }, ref) => {
  // These are your extrinsics (rotation and translation) from world to camera space.
  // prettier-ignore
  const R = new THREE.Matrix3().set(
    -0.97566293, 0.21532301, 0.04144691,
    0.11512022, 0.66386443, -0.73893934,
    -0.18662577, -0.71618435, -0.67249595,
  );
  // R.copy(new Matrix3().identity());
  const t = new THREE.Vector3(94.45499514, -537.61861834, 1674.35779694);

  // Get your intrinsic matrix via your custom hook.
  const K = useNewCameraMatrix();
  const machineSize = useMachineSize();

  const meshRef = useRef<THREE.Mesh>(null);
  const actualRef = (ref || meshRef) as React.RefObject<THREE.Mesh>;

  // Get video dimensions from the texture
  const videoDimensions = useMemo(() => {
    if (videoTexture && videoTexture.image) {
      return {
        width: videoTexture.image.videoWidth || 1280,
        height: videoTexture.image.videoHeight || 720,
      };
    }
    return { width: 1280, height: 720 };
  }, [videoTexture]);

  // Precompute the undistortion maps (as textures).
  const [mapXTexture, mapYTexture] = useMemo(() => {
    const { width, height } = videoDimensions;
    const placeholderX = new THREE.DataTexture(new Float32Array(width * height), width, height, THREE.RedFormat, THREE.FloatType);
    const placeholderY = new THREE.DataTexture(new Float32Array(width * height), width, height, THREE.RedFormat, THREE.FloatType);
    const [mapX, mapY] = calculateUndistortionMapsCached(calibrationData, width, height);
    placeholderX.image.data = mapX;
    placeholderY.image.data = mapY;
    placeholderX.needsUpdate = true;
    placeholderY.needsUpdate = true;
    return [placeholderX, placeholderY];
  }, [videoDimensions, calibrationData]);

  // Vertex shader: compute a world position from the vertex position.
  // Here we assume the plane is created with PlaneGeometry(width, height)
  // which by default is centered at (0,0) (i.e. spanning -width/2 .. width/2).
  // We pass that world position (in pixel units) as a varying to the fragment shader.
  const vertexShader = /* glsl */ `
    uniform vec2 resolution;
    varying vec2 vUv;
    varying vec2 worldPos;
    void main() {
      vUv = uv;
      // For a centered plane, position.xy is already in a coordinate space that spans -resolution/2..resolution/2.
      // If your geometry is not centered, adjust accordingly.
      // worldPos = position.xy;
      // vec4 worldPosition = modelMatrix * vec4(position, 1.0);
      vec4 worldPosition = vec4(position, 1.0);
      worldPos = worldPosition.xy;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `;

  // Fragment shader: use the worldPos from the vertex shader,
  // then compute the corresponding pixel in the camera image via intrinsics/extrinsics,
  // and finally use the undistortion maps to sample the video texture.
  const fragmentShader = /* glsl */ `
    uniform sampler2D videoTexture;
    uniform sampler2D mapXTexture;
    uniform sampler2D mapYTexture;
    uniform vec2 resolution;
    uniform mat3 K;
    uniform mat3 R;
    uniform vec3 t;
    uniform float objectHeight;
    varying vec2 vUv;
    varying vec2 worldPos;

    // Use the undistortion maps to recover the distorted image coordinate, elliminating lens distortion.
    vec2 remapTextureUv(vec2 uv) {
      float mapX = texture2D(mapXTexture, uv).r;
      float mapY = texture2D(mapYTexture, uv).r;
      return vec2(mapX, mapY) / resolution;
    }

    vec4 sampleRemappedTexture(vec2 uv) {
      vec2 remappedUV = remapTextureUv(uv);
      vec4 color = vec4(0.0);
      // Only sample if the remapped UVs are within bounds.
      if(remappedUV.x >= 0.0 && remappedUV.x <= 1.0 &&
         remappedUV.y >= 0.0 && remappedUV.y <= 1.0) {
        // Flip Y (assuming default case texture.flipY = true)
        color = texture2D(videoTexture, vec2( remappedUV.x, 1.0 - remappedUV.y));
      }
      return color;
    }

    void main() {
      // Build a 3D point from the world position (which is in pixel units) and the given objectHeight.
      vec3 worldPoint = vec3(worldPos, objectHeight);
      // Transform world point into camera space.
      vec3 pCam = R * worldPoint + t;

      // Project into the camera image plane using the intrinsic matrix.
      vec3 pImage = K * pCam;
      vec2 idealUV = pImage.xy / pImage.z;
      // idealUV is in pixel coordinates for the undistorted image.
      // Normalize to [0,1] using the resolution.
      vec2 undistortedUV = idealUV / resolution;
      // Use the undistortion maps to recover the distorted image coordinate.
      gl_FragColor = sampleRemappedTexture(undistortedUV);
    }
  `;

  const overSize = 50;
  // Create a centered plane geometry matching the video dimensions.
  const planeGeometry = useMemo(() => {
    // PlaneGeometry(width, height) is centered at (0,0) by default.
    const plane = new THREE.PlaneGeometry(machineSize.x + overSize, machineSize.y + overSize);
    plane.translate(machineSize.x / 2, machineSize.y / 2, 0);
    return plane;
  }, [machineSize]);

  // Set up all shader uniforms.
  const uniforms = useMemo(
    () => ({
      videoTexture: { value: videoTexture },
      mapXTexture: { value: mapXTexture },
      mapYTexture: { value: mapYTexture },
      resolution: { value: new THREE.Vector2(videoDimensions.width, videoDimensions.height) },
      K: { value: K },
      R: { value: R },
      t: { value: t },
      objectHeight: { value: objectHeight },
    }),
    [videoTexture, mapXTexture, mapYTexture, videoDimensions, K, objectHeight]
  );

  // useFrame(() => {
  //   uniforms.objectHeight.value += 0.1;
  //   console.log(uniforms.objectHeight.value);
  //   // videoTexture.needsUpdate = true;
  // });

  return (
    <mesh {...props} ref={actualRef} geometry={planeGeometry}>
      <shaderMaterial vertexShader={vertexShader} fragmentShader={fragmentShader} uniforms={uniforms} />
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
  // videoTexture.flipY = false;
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

  const offset = useMachineSize().divideScalar(2);
  const machineSize = useMachineSize();
  const gridSize = Math.max(machineSize.x, machineSize.y);

  return (
    <PresentCanvas worldScale="machine">
      {/* <axesHelper args={[1000]} position={[0, 0, 11]} /> */}
      <group position={[-offset.x, -offset.y, 0]}>
        <gridHelper args={[gridSize, gridSize / 50]} position={[gridSize / 2, gridSize / 2, 10]} rotation={[Math.PI / 2, 0, 0]} />
        <axesHelper args={[1000]} position={[0, 0, 11]} />
        <UnprojectVideoMesh />
      </group>
    </PresentCanvas>
  );
}
