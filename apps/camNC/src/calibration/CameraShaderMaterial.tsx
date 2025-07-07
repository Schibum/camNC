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

  const calibration = useCalibrationData();

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
  // and finally sample the video texture using an inline undistortion function.
  const fragmentShader = /* glsl */ `
    uniform sampler2D videoTexture;
    uniform sampler2D maskTexture;
    uniform sampler2D prevMaskTexture;
    uniform sampler2D bgTexture;
    uniform bool useMask;
    uniform vec2 resolution;
    uniform mat3 K;
    uniform mat3 cameraMatrix;
    uniform mat3 newCameraMatrix;
    uniform vec4 distCoeffs;
    uniform float k3;
    uniform mat3 R;
    uniform vec3 t;
    uniform float minMaskVal;
    uniform float blendFactor;
    varying vec2 vUv;
    varying vec3 worldPos;

    vec2 undistort_uv(float u, float v) {
      float fx_new = newCameraMatrix[0][0];
      float fy_new = newCameraMatrix[1][1];
      float cx_new = newCameraMatrix[2][0];
      float cy_new = newCameraMatrix[2][1];
      float nx = (u - cx_new) / fx_new;
      float ny = (v - cy_new) / fy_new;
      vec3 vec = vec3(nx, ny, 1.0);
      float x = vec.x / vec.z;
      float y = vec.y / vec.z;
      float r2 = x * x + y * y;
      float radial = 1.0 + distCoeffs.x * r2 + distCoeffs.y * r2 * r2 + k3 * r2 * r2 * r2;
      float deltaX = 2.0 * distCoeffs.z * x * y + distCoeffs.w * (r2 + 2.0 * x * x);
      float deltaY = distCoeffs.z * (r2 + 2.0 * y * y) + 2.0 * distCoeffs.w * x * y;
      float xd = x * radial + deltaX;
      float yd = y * radial + deltaY;
      float fx = cameraMatrix[0][0];
      float fy = cameraMatrix[1][1];
      float cx = cameraMatrix[2][0];
      float cy = cameraMatrix[2][1];
      float srcX = fx * xd + cx;
      float srcY = fy * yd + cy;
      return vec2(srcX, srcY);
    }

    vec2 remapTextureUv(vec2 uv) {
      vec2 srcPos = undistort_uv(uv.x * resolution.x, uv.y * resolution.y);
      return srcPos / resolution;
    }

    vec4 sampleRemappedTexture(vec2 uv) {
      vec2 remappedUV = remapTextureUv(uv);
      vec4 color = vec4(0.0);
      if(remappedUV.x >= 0.0 && remappedUV.x <= 1.0 &&
         remappedUV.y >= 0.0 && remappedUV.y <= 1.0) {
        color = texture2D(videoTexture, vec2(remappedUV.x, 1.0 - remappedUV.y));
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

      // Blend with background masks.
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

  const distCoeffsVec4 = useMemo(
    () =>
      new THREE.Vector4(
        calibration.distortion_coefficients[0] ?? 0,
        calibration.distortion_coefficients[1] ?? 0,
        calibration.distortion_coefficients[2] ?? 0,
        calibration.distortion_coefficients[3] ?? 0
      ),
    [calibration]
  );

  const k3 = calibration.distortion_coefficients[4] ?? 0;

  const uniforms = useMemo(
    () => ({
      videoTexture: { value: texture },
      maskTexture: { value: maskTex ?? texture /* dummy */ },
      prevMaskTexture: { value: maskTex ?? texture /* dummy */ },
      bgTexture: { value: bgTex ?? texture /* dummy */ },
      useMask: { value: depthBlendEnabled && !!maskTex && !!bgTex },
      resolution: { value: new THREE.Vector2(videoDimensions[0], videoDimensions[1]) },
      K: { value: K },
      cameraMatrix: { value: calibration.calibration_matrix },
      newCameraMatrix: { value: calibration.new_camera_matrix },
      distCoeffs: { value: distCoeffsVec4 },
      k3: { value: k3 },
      R: { value: R },
      t: { value: t },
      minMaskVal: { value: minMaskVal },
      blendFactor: { value: 1.0 },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  // Update uniform values when dependencies change.
  useEffect(() => {
    uniforms.videoTexture.value = texture;
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
    uniforms.cameraMatrix.value = calibration.calibration_matrix;
    uniforms.newCameraMatrix.value = calibration.new_camera_matrix;
    uniforms.distCoeffs.value.copy(distCoeffsVec4);
    uniforms.k3.value = k3;
    uniforms.R.value = R;
    uniforms.t.value = t;
    uniforms.minMaskVal.value = minMaskVal;
  }, [texture, videoDimensions, K, R, t, uniforms, maskTex, bgTex, depthBlendEnabled, minMaskVal, calibration, distCoeffsVec4, k3]);

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
}
