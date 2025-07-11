import { useStillFrameTexture } from '@/hooks/useStillFrameTexture';
import { PresentCanvas } from '@/scene/PresentCanvas';
import { useMachineSize, useShowStillFrame } from '@/store/store';
import { type ThreeElements } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { CameraShaderMaterial } from './CameraShaderMaterial';
import { useCameraTexture } from './useCameraTexture';

export const UnprojectVideoMesh = ({ overSize = 50, ref, ...props }: { overSize?: number } & ThreeElements['mesh']) => {
  const machineSize = useMachineSize();
  const useStillFrame = useShowStillFrame();
  const [stillFrameTexture, updateStillFrameTexture] = useStillFrameTexture();
  const videoTexture = useCameraTexture();

  useEffect(() => {
    if (useStillFrame) updateStillFrameTexture();
  }, [updateStillFrameTexture, useStillFrame]);

  // Create a centered plane geometry matching the video dimensions.
  const planeGeometry = useMemo(() => {
    // PlaneGeometry(width, height) is centered at (0,0) by default.
    const plane = new THREE.PlaneGeometry(machineSize.x + overSize, machineSize.y + overSize);
    plane.translate(machineSize.x / 2, machineSize.y / 2, 0);
    return plane;
  }, [machineSize, overSize]);

  return (
    <mesh ref={ref} geometry={planeGeometry} {...props}>
      {useStillFrame ? (
        <CameraShaderMaterial key="stillFrame" texture={stillFrameTexture} />
      ) : (
        <CameraShaderMaterial key="video" texture={videoTexture} />
      )}
    </mesh>
  );
};

// Add display name for debugging
UnprojectVideoMesh.displayName = 'UnprojectVideoMesh';

export function UnprojectTsl() {
  const machineSize = useMachineSize();
  const gridSize = Math.max(machineSize.x, machineSize.y);

  return (
    <PresentCanvas worldScale="machine">
      {/* <axesHelper args={[1000]} position={[0, 0, 11]} /> */}
      <group>
        <gridHelper args={[gridSize, gridSize / 25]} position={[gridSize / 2, gridSize / 2, 10]} rotation={[Math.PI / 2, 0, 0]} />
        <axesHelper args={[1000]} position={[0, 0, 11]} />
        <UnprojectVideoMesh />
      </group>
    </PresentCanvas>
  );
}
