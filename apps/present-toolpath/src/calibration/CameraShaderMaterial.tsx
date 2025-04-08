import { useCalibrationData, useCameraExtrinsics, useNewCameraMatrix, useVideoDimensions } from '@/store';
import React, { useMemo } from 'react';
import * as THREE from 'three';
import { useCameraTexture } from './useCameraTexture';
import { calculateUndistortionMapsCached } from './UnskewTsl';

export function CameraShaderMaterial() {
  const videoTexture = useCameraTexture();
  // These are your extrinsics (rotation and translation) from world to camera space.
  // prettier-ignore
  const { R, t } = useCameraExtrinsics();
  // Get your intrinsic matrix via your custom hook.
  const K = useNewCameraMatrix();
  const videoDimensions = useVideoDimensions();

  // Precompute the undistortion maps (as textures).
  const [mapXTexture, mapYTexture] = useUnmapTextures();

  // Vertex shader: compute a world position from the vertex position.
  // Here we assume the plane is created with PlaneGeometry(width, height)
  // which by default is centered at (0,0) (i.e. spanning -width/2 .. width/2).
  // We pass that world position (in pixel units) as a varying to the fragment shader.
  const vertexShader = /* glsl */ `
    uniform vec2 resolution;
    varying vec2 vUv;
    varying vec3 worldPos;
    void main() {
      vUv = uv;
      // For a centered plane, position.xy is already in a coordinate space that spans -resolution/2..resolution/2.
      // If your geometry is not centered, adjust accordingly.
      // worldPos = position.xy;
      vec4 worldPosition = modelMatrix * vec4(position, 1.0);
      // vec4 worldPosition = vec4(position, 1.0);
      worldPos = worldPosition.xyz;
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
    varying vec3 worldPos;

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
      // Transform world point into camera space.
      vec3 pCam = R * worldPos + t;

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

  // Set up all shader uniforms.
  const uniforms = useMemo(
    () => ({
      videoTexture: { value: videoTexture },
      mapXTexture: { value: mapXTexture },
      mapYTexture: { value: mapYTexture },
      resolution: { value: new THREE.Vector2(videoDimensions[0], videoDimensions[1]) },
      K: { value: K },
      R: { value: R },
      t: { value: t },
      objectHeight: { value: 0 },
    }),
    [videoTexture, mapXTexture, mapYTexture, videoDimensions, K, R, t]
  );

  return <shaderMaterial vertexShader={vertexShader} fragmentShader={fragmentShader} uniforms={uniforms} />;
} /**
 * Precompute the undistortion maps (as textures).
 * @returns [mapXTexture, mapYTexture]
 */

export function useUnmapTextures(): [THREE.DataTexture, THREE.DataTexture] {
  const calibrationData = useCalibrationData();
  const videoDimensions = useVideoDimensions();
  return useMemo(() => {
    const [width, height] = videoDimensions;
    const placeholderX = new THREE.DataTexture(new Float32Array(width * height), width, height, THREE.RedFormat, THREE.FloatType);
    const placeholderY = new THREE.DataTexture(new Float32Array(width * height), width, height, THREE.RedFormat, THREE.FloatType);
    const [mapX, mapY] = calculateUndistortionMapsCached(calibrationData, width, height);
    placeholderX.image.data = mapX;
    placeholderY.image.data = mapY;
    placeholderX.needsUpdate = true;
    placeholderY.needsUpdate = true;
    return [placeholderX, placeholderY];
  }, [videoDimensions, calibrationData]);
}
