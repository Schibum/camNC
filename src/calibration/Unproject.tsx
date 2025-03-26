import { PresentCanvas } from '@/scene/PresentCanvas';
import { useCalibrationData, useMachineSize, useVideoSrc } from '@/store';
import { type ThreeElements } from '@react-three/fiber';
import React, { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { CameraShaderMaterial } from './CameraShaderMaterial';

export const UnprojectVideoMesh = React.forwardRef<
  THREE.Mesh,
  {
    overSize?: number;
  } & ThreeElements['mesh']
>(({ overSize = 50, ...props }, ref) => {
  const machineSize = useMachineSize();

  const meshRef = useRef<THREE.Mesh>(null);
  const actualRef = (ref || meshRef) as React.RefObject<THREE.Mesh>;

  // Create a centered plane geometry matching the video dimensions.
  const planeGeometry = useMemo(() => {
    // PlaneGeometry(width, height) is centered at (0,0) by default.
    const plane = new THREE.PlaneGeometry(machineSize.x + overSize, machineSize.y + overSize);
    plane.translate(machineSize.x / 2, machineSize.y / 2, 0);
    return plane;
  }, [machineSize, overSize]);

  // useFrame(() => {
  //   if (actualRef.current) {
  //     actualRef.current.position.z += 0.1;
  //     console.log(actualRef.current.position.z);
  //   }
  // });

  return (
    <mesh {...props} ref={actualRef} geometry={planeGeometry}>
      <CameraShaderMaterial />
    </mesh>
  );
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

  const machineSize = useMachineSize();
  const gridSize = Math.max(machineSize.x, machineSize.y);

  return (
    <PresentCanvas worldScale="machine">
      {/* <axesHelper args={[1000]} position={[0, 0, 11]} /> */}
      <group>
        <gridHelper args={[gridSize, gridSize / 50]} position={[gridSize / 2, gridSize / 2, 10]} rotation={[Math.PI / 2, 0, 0]} />
        <axesHelper args={[1000]} position={[0, 0, 11]} />
        <UnprojectVideoMesh />
      </group>
    </PresentCanvas>
  );
}
