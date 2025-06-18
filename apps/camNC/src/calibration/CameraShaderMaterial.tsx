/* eslint-disable react-refresh/only-export-components */
import { useCalibrationData, useCameraExtrinsics, useCamResolution, useNewCameraMatrix } from '@/store/store';
import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { calculateUndistortionMapsCached } from './rectifyMap';

export function CameraShaderMaterial({ texture }: { texture: THREE.Texture }) {
  // These are your extrinsics (rotation and translation) from world to camera space.
  const { R, t } = useCameraExtrinsics();
  // Get your intrinsic matrix via your custom hook.
  const K = useNewCameraMatrix();
  const videoDimensions = useCamResolution();

  // Camera calibration for distortion correction
  const calibrationData = useCalibrationData();

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
  // and apply distortion correction directly in the shader.
  const fragmentShader = /* glsl */ `
    uniform sampler2D videoTexture;
    uniform vec2 resolution;
    uniform mat3 K;
    uniform mat3 Kdist;
    uniform vec3 distRadial;
    uniform vec2 distTangential;
    uniform mat3 R;
    uniform vec3 t;
    varying vec2 vUv;
    varying vec3 worldPos;

    vec2 distortPoint(vec2 undistortedPixel) {
      float fx_n = K[0][0];
      float fy_n = K[1][1];
      float cx_n = K[2][0];
      float cy_n = K[2][1];

      float fx_d = Kdist[0][0];
      float fy_d = Kdist[1][1];
      float cx_d = Kdist[2][0];
      float cy_d = Kdist[2][1];

      float x = (undistortedPixel.x - cx_n) / fx_n;
      float y = (undistortedPixel.y - cy_n) / fy_n;

      float r2 = x * x + y * y;
      float radial = 1.0 + distRadial.x * r2 + distRadial.y * r2 * r2 + distRadial.z * r2 * r2 * r2;
      float deltaX = 2.0 * distTangential.x * x * y + distTangential.y * (r2 + 2.0 * x * x);
      float deltaY = distTangential.x * (r2 + 2.0 * y * y) + 2.0 * distTangential.y * x * y;
      float xDistorted = x * radial + deltaX;
      float yDistorted = y * radial + deltaY;

      float u = fx_d * xDistorted + cx_d;
      float v = fy_d * yDistorted + cy_d;
      return vec2(u, v);
    }

    vec4 sampleDistortedTexture(vec2 undistortedPixel) {
      vec2 distorted = distortPoint(undistortedPixel);
      vec2 uv = distorted / resolution;
      vec4 color = vec4(0.0);
      if(uv.x >= 0.0 && uv.x <= 1.0 && uv.y >= 0.0 && uv.y <= 1.0) {
        color = texture2D(videoTexture, vec2(uv.x, 1.0 - uv.y));
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
      // Apply distortion correction and sample the video texture.
      gl_FragColor = sampleDistortedTexture(undistortedUV);
    }
  `;

  const uniforms = useMemo(
    () => ({
      videoTexture: { value: texture },
      resolution: { value: new THREE.Vector2(videoDimensions[0], videoDimensions[1]) },
      K: { value: K },
      Kdist: { value: calibrationData.calibration_matrix },
      distRadial: {
        value: new THREE.Vector3(
          calibrationData.distortion_coefficients[0] || 0,
          calibrationData.distortion_coefficients[1] || 0,
          calibrationData.distortion_coefficients[4] || 0
        ),
      },
      distTangential: {
        value: new THREE.Vector2(calibrationData.distortion_coefficients[2] || 0, calibrationData.distortion_coefficients[3] || 0),
      },
      R: { value: R },
      t: { value: t },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  // Update uniform values when dependencies change.
  useEffect(() => {
    uniforms.videoTexture.value = texture;
    uniforms.resolution.value.set(videoDimensions[0], videoDimensions[1]);
    uniforms.K.value = K;
    uniforms.Kdist.value = calibrationData.calibration_matrix;
    uniforms.distRadial.value.set(
      calibrationData.distortion_coefficients[0] || 0,
      calibrationData.distortion_coefficients[1] || 0,
      calibrationData.distortion_coefficients[4] || 0
    );
    uniforms.distTangential.value.set(calibrationData.distortion_coefficients[2] || 0, calibrationData.distortion_coefficients[3] || 0);
    uniforms.R.value = R;
    uniforms.t.value = t;
  }, [texture, videoDimensions, K, R, t, calibrationData, uniforms]);

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
