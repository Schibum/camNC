/* eslint-disable react-refresh/only-export-components */
import { useCalibrationData, useCameraExtrinsics, useCamResolution, useNewCameraMatrix } from '@/store/store';
import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { calculateUndistortionMapsCached } from './rectifyMap';

export function CameraShaderMaterial({
  texture,
  displacementMap,
  displacementScale = 0,
}: {
  texture: THREE.Texture;
  displacementMap?: THREE.Texture;
  displacementScale?: number;
}) {
  console.log('displacementMap', displacementMap, displacementScale);
  // These are your extrinsics (rotation and translation) from world to camera space.
  const { R, t } = useCameraExtrinsics();
  // Get your intrinsic matrix via your custom hook.
  const K = useNewCameraMatrix();
  const videoDimensions = useCamResolution();

  // Precompute the undistortion maps (as textures).
  const [mapXTexture, mapYTexture] = useUnmapTextures();

  // Vertex shader: compute a world position from the vertex position.
  // Here we assume the plane is created with PlaneGeometry(width, height)
  // which by default is centered at (0,0) (i.e. spanning -width/2 .. width/2).
  // We pass that world position (in pixel units) as a varying to the fragment shader.
  const vertexShader = /* glsl */ `
    uniform vec2 resolution;
    uniform sampler2D displacementMap;
    uniform float displacementScale;
    uniform bool hasDisplacementMap;
    varying vec2 vUv;
    varying vec3 worldPos;
    void main() {
      vUv = uv;
      vec4 worldPosition = modelMatrix * vec4(position, 1.0);
      worldPos = worldPosition.xyz;
      gl_Position = projectionMatrix * modelViewMatrix * worldPosition;
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
    uniform bool hasDisplacementMap;
    uniform sampler2D displacementMap;
    uniform float displacementScale;
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

    float sampleRemappedDisplacement(vec2 uv) {
      vec2 remappedUV = remapTextureUv(uv);
      // Outside bounds → no displacement.
      if(remappedUV.x < 0.0 || remappedUV.x > 1.0 || remappedUV.y < 0.0 || remappedUV.y > 1.0) {
        return 0.0;
      }
      return texture2D(displacementMap, vec2( remappedUV.x, 1.0 - remappedUV.y )).r;
    }

    void main() {
      // First: project original worldPos to image to get undistorted UV for displacement lookup.
      vec3 pCam0 = R * worldPos + t;
      vec3 pImg0 = K * pCam0;
      vec2 undistUV0 = (pImg0.xy / pImg0.z) / resolution;

      // Sample displacement map after remapping.
      float dispVal = hasDisplacementMap ? sampleRemappedDisplacement(undistUV0) : 1.0;
      float disp = displacementScale != 0.0 ? dispVal * displacementScale : 0.0;

      // Apply displacement along +Z of world (assuming plane normal).
      vec3 displacedWorld = worldPos + vec3(0.0, 0.0, disp);

      // Recalculate projection with displaced point.
      vec3 pCam = R * displacedWorld + t;
      vec3 pImage = K * pCam;
      vec2 idealUV = pImage.xy / pImage.z;
      vec2 undistortedUV = idealUV / resolution;

      // Sample video texture.
      gl_FragColor = sampleRemappedTexture(undistortedUV);
      gl_FragColor.r = hasDisplacementMap ? texture2D(displacementMap, undistortedUV).r : 1.0;
    }
  `;

  const uniforms = useMemo(
    () => ({
      videoTexture: { value: texture },
      mapXTexture: { value: mapXTexture },
      mapYTexture: { value: mapYTexture },
      displacementMap: { value: displacementMap ?? new THREE.Texture() },
      displacementScale: { value: displacementScale },
      hasDisplacementMap: { value: Boolean(displacementMap) },
      resolution: { value: new THREE.Vector2(videoDimensions[0], videoDimensions[1]) },
      K: { value: K },
      R: { value: R },
      t: { value: t },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  // Update uniform values when dependencies change.
  useEffect(() => {
    uniforms.videoTexture.value = texture;
    uniforms.mapXTexture.value = mapXTexture;
    uniforms.mapYTexture.value = mapYTexture;
    uniforms.displacementMap.value = displacementMap ?? uniforms.displacementMap.value;
    uniforms.displacementScale.value = displacementScale;
    uniforms.hasDisplacementMap.value = Boolean(displacementMap);
    uniforms.resolution.value.set(videoDimensions[0], videoDimensions[1]);
    uniforms.K.value = K;
    uniforms.R.value = R;
    uniforms.t.value = t;
  }, [texture, mapXTexture, mapYTexture, displacementMap, displacementScale, videoDimensions, K, R, t, uniforms]);

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
