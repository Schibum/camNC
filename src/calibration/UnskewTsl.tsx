import { calibrationDataAtom, videoSrcAtom } from '@/atoms';
import { OrbitControls, Text, useVideoTexture } from '@react-three/drei';
import { Canvas, useThree } from '@react-three/fiber';
import { useAtomValue } from 'jotai';
import React, { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { CalibrationData } from './undistort';
import { waitForOpenCvGlobal } from './waitForOpenCvGlobal';
import useContain from './useContain';

interface UnskewTslProps {
  width?: number;
  height?: number;
}

/**
 * Calculate the undistortion maps from OpenCV camera parameters
 * @param calibrationData Camera calibration data with intrinsic matrix and distortion coefficients
 * @param width Image width
 * @param height Image height
 * @returns {Float32Array[]} Arrays for X and Y undistortion maps
 */
async function calculateUndistortionMaps(
  calibrationData: CalibrationData,
  width: number,
  height: number
): Promise<[Float32Array, Float32Array]> {
  // Wait for OpenCV to be loaded
  await waitForOpenCvGlobal();
  const cv = (window as any).cv;

  // Extract camera matrix and distortion coefficients
  const { calibration_matrix, distortion_coefficients } = calibrationData;

  // Create camera matrix
  const cameraMatrix = cv.matFromArray(3, 3, cv.CV_64F, [
    calibration_matrix[0][0],
    calibration_matrix[0][1],
    calibration_matrix[0][2],
    calibration_matrix[1][0],
    calibration_matrix[1][1],
    calibration_matrix[1][2],
    calibration_matrix[2][0],
    calibration_matrix[2][1],
    calibration_matrix[2][2],
  ]);

  // Create distortion coefficients
  const distCoeffs = cv.matFromArray(1, 5, cv.CV_64F, [
    distortion_coefficients[0][0],
    distortion_coefficients[0][1],
    distortion_coefficients[0][2],
    distortion_coefficients[0][3],
    distortion_coefficients[0][4] || 0,
  ]);

  // Create maps
  const map1 = new cv.Mat();
  const map2 = new cv.Mat();

  // Initialize undistortion maps
  cv.initUndistortRectifyMap(
    cameraMatrix,
    distCoeffs,
    new cv.Mat(), // R - identity rotation
    cameraMatrix,
    new cv.Size(width, height),
    cv.CV_32FC1,
    map1,
    map2
  );

  // Convert OpenCV maps to Float32Arrays
  const mapXArray = new Float32Array(width * height);
  const mapYArray = new Float32Array(width * height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = y * width + x;
      mapXArray[index] = map1.floatAt(y, x);
      mapYArray[index] = map2.floatAt(y, x);
    }
  }

  // Clean up OpenCV matrices
  cameraMatrix.delete();
  distCoeffs.delete();
  map1.delete();
  map2.delete();

  return [mapXArray, mapYArray];
}

// UndistortMesh component using Three.js Shading
const UndistortMesh: React.FC<{
  videoTexture: THREE.VideoTexture;
  calibrationData: CalibrationData;
}> = ({ videoTexture, calibrationData }) => {
  const meshRef = useRef<THREE.Mesh>(null);

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
    const placeholderX = new THREE.DataTexture(
      new Float32Array(width * height),
      width,
      height,
      THREE.RedFormat,
      THREE.FloatType
    );

    const placeholderY = new THREE.DataTexture(
      new Float32Array(width * height),
      width,
      height,
      THREE.RedFormat,
      THREE.FloatType
    );

    // Calculate maps asynchronously and update textures when ready
    calculateUndistortionMaps(calibrationData, width, height)
      .then(([mapX, mapY]) => {
        placeholderX.image.data = mapX;
        placeholderY.image.data = mapY;
        placeholderX.needsUpdate = true;
        placeholderY.needsUpdate = true;
        console.log('Undistortion maps calculated successfully');
      })
      .catch(err => {
        console.error('Error calculating undistortion maps:', err);
      });

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

  const containSize = useContain(videoDimensions.width, videoDimensions.height);

  // Plane geometry with correct aspect ratio
  const planeGeometry = useMemo(() => {
    return new THREE.PlaneGeometry(containSize.planeWidth, containSize.planeHeight);
  }, [videoDimensions, containSize]);

  return (
    <mesh ref={meshRef} geometry={planeGeometry}>
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
};

// New UnskewedVideoMesh component to load video texture
export function UnskewedVideoMesh() {
  const calibrationData = useAtomValue(calibrationDataAtom);
  const videoSrc = useAtomValue(videoSrcAtom);

  // Use drei's useVideoTexture hook to load video texture
  const videoTexture = useVideoTexture(videoSrc, {
    crossOrigin: 'anonymous',
    muted: true,
    loop: true,
    start: true,
  });

  return <UndistortMesh videoTexture={videoTexture} calibrationData={calibrationData} />;
}

// Main component
const UnskewTsl: React.FC<UnskewTslProps> = ({ width = 800, height = 600 }) => {
  // Handle missing calibration data - calibrationData is now passed through UnskewedVideoMesh
  const calibrationData = useAtomValue(calibrationDataAtom);
  if (
    !calibrationData ||
    !calibrationData.calibration_matrix ||
    !calibrationData.distortion_coefficients
  ) {
    return (
      <div className="p-4 text-yellow-500 bg-yellow-50 border border-yellow-200 rounded">
        <p>Missing or invalid calibration data</p>
        <p className="text-sm mt-2">Please provide valid camera calibration parameters.</p>
      </div>
    );
  }

  // Handle missing video source - videoSrc is now handled in UnskewedVideoMesh
  const videoSrc = useAtomValue(videoSrcAtom);
  if (!videoSrc) {
    return (
      <div className="p-4 text-red-500 bg-red-50 border border-red-200 rounded">
        <p>No video source provided</p>
        <p className="text-sm mt-2">Please set a valid video source URL.</p>
      </div>
    );
  }

  return (
    <div style={{ width, height }}>
      <Canvas
        orthographic
        camera={{ near: -1000, far: 1000 }}
        gl={{ antialias: true, outputColorSpace: THREE.SRGBColorSpace }}
      >
        <ErrorBoundary fallback={<FallbackContent />}>
          <UnskewedVideoMesh />
          <OrbitControls enableRotate={false} enablePan={true} enableZoom={true} />
        </ErrorBoundary>
      </Canvas>
    </div>
  );
};

// Error boundary component to catch errors in Three.js
class ErrorBoundary extends React.Component<
  { children: React.ReactNode; fallback: React.ReactNode },
  { hasError: boolean }
> {
  constructor(props: { children: React.ReactNode; fallback: React.ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: any, errorInfo: any) {
    console.error('Error in Three.js component:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback;
    }
    return this.props.children;
  }
}

// Fallback content for when the Three.js component errors
const FallbackContent = () => (
  <mesh>
    <planeGeometry args={[2, 2]} />
    <meshBasicMaterial color="red" />
    <Text position={[0, 0, 0.1]} fontSize={0.1} color="white">
      Error loading video texture
    </Text>
  </mesh>
);

export default UnskewTsl;
