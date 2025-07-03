/* eslint-disable react-refresh/only-export-components */
import {
  useBgTexture,
  useCalibrationData,
  useCameraExtrinsics,
  useCamResolution,
  useDepthBlendEnabled,
  useDepthSettings,
  useMaskTexture,
  useNewCameraMatrix,
} from '@/store/store';
import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { calculateUndistortionMapsCached } from './rectifyMap';

export function CameraShaderMaterial({ texture }: { texture: THREE.Texture }) {
  // These are your extrinsics (rotation and translation) from world to camera space.
  const { R, t } = useCameraExtrinsics();
  // Get your intrinsic matrix via your custom hook.
  const K = useNewCameraMatrix();
  const videoDimensions = useCamResolution();

  // Depth blend feature
  const depthBlendEnabled = useDepthBlendEnabled();
  const maskTex = useMaskTexture();
  const bgTex = useBgTexture();
  const { minMaskVal } = useDepthSettings();

  // Precompute the undistortion maps (as textures).
  const [mapXTexture, mapYTexture] = useUnmapTextures();

  // Keep reference to previous mask for cross-fade
  const prevMaskRef = useRef<THREE.Texture | null>(null);
  const transitionStartRef = useRef<number | null>(null);
  const TRANSITION_MS = 200;

  // Vertex shader: compute a world position from the vertex position.
  // We pass that world position (in pixel units) as a varying to the fragment shader.
  const vertexShader = /* glsl */ `
    uniform vec2 resolution;
    varying vec2 vUv;
    varying vec3 worldPos;
    void main() {
      vUv = uv;
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
    uniform sampler2D maskTexture;
    uniform sampler2D prevMaskTexture;
    uniform sampler2D bgTexture;
    uniform bool useMask;
    uniform vec2 resolution;
    uniform mat3 K;
    uniform mat3 R;
    uniform vec3 t;
    uniform float minMaskVal;
    uniform float blendFactor;
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

      // TODO: lookup worldPos in depth map here, if > threshold (masked),
      //  then sample undistorted cachedTexture instead?
      // Use the undistortion maps to recover the distorted image coordinate.
      float currMask = texture2D(maskTexture, undistortedUV).r;
      float prevMask = texture2D(prevMaskTexture, undistortedUV).r;
      float blendedMask = mix(prevMask, currMask, blendFactor);
      float maskVal = useMask ? max(blendedMask, minMaskVal) : 1.0;
      vec4 videoCol = sampleRemappedTexture(undistortedUV);
      vec4 bgCol = useMask ? texture2D(bgTexture, undistortedUV) : vec4(0.0);
      gl_FragColor = videoCol * maskVal + bgCol * (1.0 - maskVal);
      // gl_FragColor.r = videoCol.r;
    }
  `;

  const uniforms = useMemo(
    () => ({
      videoTexture: { value: texture },
      mapXTexture: { value: mapXTexture },
      mapYTexture: { value: mapYTexture },
      maskTexture: { value: maskTex ?? texture /* dummy */ },
      prevMaskTexture: { value: maskTex ?? texture /* dummy */ },
      bgTexture: { value: bgTex ?? texture /* dummy */ },
      useMask: { value: depthBlendEnabled && !!maskTex && !!bgTex },
      resolution: { value: new THREE.Vector2(videoDimensions[0], videoDimensions[1]) },
      K: { value: K },
      R: { value: R },
      t: { value: t },
      minMaskVal: { value: minMaskVal },
      blendFactor: { value: 1.0 },
    }),
    []
  );

  // Update uniform values when dependencies change.
  useEffect(() => {
    uniforms.videoTexture.value = texture;
    uniforms.mapXTexture.value = mapXTexture;
    uniforms.mapYTexture.value = mapYTexture;
    // If mask texture changed, start transition
    if (uniforms.maskTexture.value !== maskTex && maskTex) {
      prevMaskRef.current = uniforms.maskTexture.value as THREE.Texture;
      uniforms.prevMaskTexture.value = prevMaskRef.current ?? maskTex;
      uniforms.maskTexture.value = maskTex;
      uniforms.blendFactor.value = 0.0;
      transitionStartRef.current = performance.now();
    }
    uniforms.bgTexture.value = bgTex ?? texture;
    uniforms.useMask.value = depthBlendEnabled && !!maskTex && !!bgTex;
    uniforms.resolution.value.set(videoDimensions[0], videoDimensions[1]);
    uniforms.K.value = K;
    uniforms.R.value = R;
    uniforms.t.value = t;
    uniforms.minMaskVal.value = minMaskVal;
  }, [texture, mapXTexture, mapYTexture, videoDimensions, K, R, t, uniforms, maskTex, bgTex, depthBlendEnabled, minMaskVal]);

  // Advance blendFactor each frame
  useFrame(() => {
    if (transitionStartRef.current !== null) {
      const elapsed = performance.now() - transitionStartRef.current;
      const f = Math.min(1, elapsed / TRANSITION_MS);
      uniforms.blendFactor.value = f;
      if (f >= 1) {
        transitionStartRef.current = null;
        // After transition complete, align prev texture to current to save memory
        uniforms.prevMaskTexture.value = uniforms.maskTexture.value;
      }
    }
  });

  return <shaderMaterial vertexShader={vertexShader} fragmentShader={fragmentShader} uniforms={uniforms} />;
} /**
 * Precompute the undistortion maps (as textures).
 * @returns [mapXTexture, mapYTexture]
 */

export function useUnmapTextures(): [THREE.DataTexture, THREE.DataTexture] {
  const calibrationData = useCalibrationData();
  const videoDimensions = useCamResolution();
  return useMemo(() => {
    const [width, height] = videoDimensions;
    const [mapX, mapY] = calculateUndistortionMapsCached(calibrationData, width, height);
    const texX = new THREE.DataTexture(mapX, width, height, THREE.RedFormat, THREE.FloatType);
    const texY = new THREE.DataTexture(mapY, width, height, THREE.RedFormat, THREE.FloatType);
    // texX.image.data = mapX;
    // texY.image.data = mapY;
    texX.needsUpdate = true;
    texY.needsUpdate = true;
    return [texX, texY];
  }, [videoDimensions, calibrationData]);
}
