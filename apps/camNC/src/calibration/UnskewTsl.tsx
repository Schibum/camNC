import { PresentCanvas } from '@/scene/PresentCanvas';
import { useCalibrationData, useCamResolution, useVideoUrl } from '@/store/store';
import { type ThreeElements } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { useCameraTexture } from './useCameraTexture';

// UndistortMesh component using Three.js Shading
export function UnskewedVideoMesh({ ...props }: ThreeElements['mesh']) {
  const videoDimensions = useCamResolution();
  const videoTexture = useCameraTexture();
  const calibration = useCalibrationData();

  // Basic GLSL shader for undistortion
  const vertexShader = /* glsl */ `
    varying vec2 vUv;

    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `;

  const fragmentShader = /* glsl */ `
    uniform sampler2D videoTexture;
    uniform mat3 cameraMatrix;
    uniform mat3 newCameraMatrix;
    uniform vec4 distCoeffs;
    uniform float k3;
    uniform vec2 resolution;

    varying vec2 vUv;

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

    void main() {
      vec2 pixel = vec2(vUv.x, 1.0 - vUv.y) * resolution;
      vec2 src = undistort_uv(pixel.x, pixel.y) / resolution;
      vec4 color = vec4(0.0, 0.0, 0.0, 1.0);
      if (src.x >= 0.0 && src.x <= 1.0 && src.y >= 0.0 && src.y <= 1.0) {
        color = texture2D(videoTexture, vec2(src.x, 1.0 - src.y));
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
      videoTexture: { value: videoTexture },
      cameraMatrix: { value: calibration.calibration_matrix },
      newCameraMatrix: { value: calibration.new_camera_matrix },
      distCoeffs: { value: distCoeffsVec4 },
      k3: { value: k3 },
      resolution: { value: new THREE.Vector2(videoDimensions[0], videoDimensions[1]) },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  // Update uniform values when dependencies change
  useEffect(() => {
    uniforms.videoTexture.value = videoTexture;
    uniforms.cameraMatrix.value = calibration.calibration_matrix;
    uniforms.newCameraMatrix.value = calibration.new_camera_matrix;
    uniforms.distCoeffs.value.copy(distCoeffsVec4);
    uniforms.k3.value = k3;
    uniforms.resolution.value.set(videoDimensions[0], videoDimensions[1]);
  }, [videoTexture, videoDimensions, calibration, distCoeffsVec4, k3, uniforms]);

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
