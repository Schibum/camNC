import { useStillFrameTexture } from '@/hooks/useStillFrameTexture';
import { PresentCanvas } from '@/scene/PresentCanvas';
import { useMachineBounds, useMachineCenter, useMachineSize, useShowStillFrame } from '@/store/store';
import { type ThreeElements } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { CameraShaderMaterial } from './CameraShaderMaterial';
import { getMachinePlaneLayout } from './machinePlane';
import { useCameraTexture } from './useCameraTexture';

export const UnprojectVideoMesh = ({
  overSize = 50,
  bounds,
  opacity = 1,
  ref,
  ...props
}: {
  overSize?: number;
  // Area to cover (machine coordinates), defaults to the machine bounds plus `overSize`.
  bounds?: THREE.Box2;
  opacity?: number;
} & ThreeElements['mesh']) => {
  const machineBounds = useMachineBounds();
  const useStillFrame = useShowStillFrame();
  const [stillFrameTexture, updateStillFrameTexture] = useStillFrameTexture();
  const videoTexture = useCameraTexture();

  useEffect(() => {
    if (useStillFrame) updateStillFrameTexture();
  }, [updateStillFrameTexture, useStillFrame]);

  // Create a centered plane geometry matching the video dimensions.
  const planeGeometry = useMemo(() => {
    // PlaneGeometry(width, height) is centered at (0,0) by default.
    const { width, height, center } = bounds ? getMachinePlaneLayout(bounds) : getMachinePlaneLayout(machineBounds, overSize);
    const plane = new THREE.PlaneGeometry(width, height);
    plane.translate(center.x, center.y, 0);
    return plane;
  }, [bounds, machineBounds, overSize]);
  useEffect(() => () => planeGeometry.dispose(), [planeGeometry]);

  return (
    <mesh ref={ref} geometry={planeGeometry} {...props}>
      {useStillFrame ? (
        <CameraShaderMaterial key="stillFrame" texture={stillFrameTexture} opacity={opacity} />
      ) : (
        <CameraShaderMaterial key="video" texture={videoTexture} opacity={opacity} />
      )}
    </mesh>
  );
};

// Add display name for debugging
UnprojectVideoMesh.displayName = 'UnprojectVideoMesh';

export function UnprojectTsl() {
  const machineSize = useMachineSize();
  const machineCenter = useMachineCenter();
  const gridSize = Math.max(machineSize.x, machineSize.y);

  return (
    <PresentCanvas worldScale="machine">
      {/* <axesHelper args={[1000]} position={[0, 0, 11]} /> */}
      <group>
        <gridHelper args={[gridSize, gridSize / 25]} position={[machineCenter.x, machineCenter.y, 10]} rotation={[Math.PI / 2, 0, 0]} />
        <axesHelper args={[1000]} position={[0, 0, 11]} />
        <UnprojectVideoMesh />
      </group>
    </PresentCanvas>
  );
}
