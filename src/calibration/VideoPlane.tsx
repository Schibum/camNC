import React, { useRef, useMemo } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useUndistortedCanvas, UndistortedTexture } from './useUndistortedCanvas';
import { useContain } from './scaleHooks';

interface VideoPlaneProps {}

const VideoPlane: React.FC<VideoPlaneProps> = () => {
  const canvas = useUndistortedCanvas();
  const meshRef = useRef<THREE.Mesh>(null);
  const { planeWidth, planeHeight } = useContain(canvas.width, canvas.height);
  const camera = useThree().camera as THREE.OrthographicCamera;
  console.log('camera', camera, [camera.left, camera.right, camera.top, camera.bottom]);

  const planeGeometry = useMemo(() => {
    return new THREE.PlaneGeometry(planeWidth, planeHeight);
  }, [planeWidth, planeHeight]);

  return (
    <mesh ref={meshRef} geometry={planeGeometry}>
      <meshBasicMaterial side={THREE.DoubleSide}>
        <UndistortedTexture />
      </meshBasicMaterial>
    </mesh>
  );
};

export default VideoPlane;
