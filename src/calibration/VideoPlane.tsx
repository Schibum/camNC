import React, { useRef, useMemo, useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';

interface VideoPlaneProps {
  textureRef: React.MutableRefObject<THREE.Texture | null>;
  videoRef: React.RefObject<HTMLVideoElement>;
}

const VideoPlane: React.FC<VideoPlaneProps> = ({ textureRef, videoRef }) => {
  const meshRef = useRef<THREE.Mesh>(null);
  const { size } = useThree();

  // Calculate proper aspect ratio based on the video dimensions
  const planeGeometry = useMemo(() => {
    const video = videoRef.current;
    if (!video) throw new Error('Video not found');
    const containerAspect = size.width / size.height;
    const videoAspect = video.videoWidth / video.videoHeight;

    let planeWidth, planeHeight;
    if (containerAspect > videoAspect) {
      // Container is wider than video - fit to height
      planeHeight = size.height;
      planeWidth = planeHeight * videoAspect;
    } else {
      // Container is taller than video - fit to width
      planeWidth = size.width;
      planeHeight = planeWidth / videoAspect;
    }

    return new THREE.PlaneGeometry(planeWidth, planeHeight);
  }, [videoRef, size]);

  // Update texture when the video plays
  useEffect(() => {
    const texture = textureRef.current;
    if (texture) {
      texture.minFilter = THREE.LinearFilter;
      texture.magFilter = THREE.LinearFilter;
    }
  }, [textureRef]);

  return (
    <mesh ref={meshRef} geometry={planeGeometry}>
      <meshBasicMaterial
        map={textureRef.current}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
};

export default VideoPlane;