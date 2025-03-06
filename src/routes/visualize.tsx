import * as React from 'react'
import { useEffect, useRef, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import * as THREE from 'three'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { computeHomography, buildMatrix4FromHomography } from '../math/perspectiveTransform'
import { useAtomValue } from 'jotai'
import { cameraConfigAtom, IBox } from '../atoms'

export const Route = createFileRoute('/visualize')({
  component: VisualizeComponent,
})

// Add type for camConfig if needed
interface SceneProps {
  video: HTMLVideoElement;
  camConfig: any; // Replace with actual type if available
}

function VisualizeComponent() {
  const camConfig = useAtomValue(cameraConfigAtom);
  const [videoElement, setVideoElement] = useState<HTMLVideoElement | null>(null);

  useEffect(() => {
    if (!camConfig) return;

    // Create video element
    const video = document.createElement('video');
    video.crossOrigin = 'anonymous';
    video.src = camConfig.url;
    video.muted = true;
    video.playsInline = true;

    // Start video playback
    video.play().catch(console.error);
    setVideoElement(video);

    // Cleanup
    return () => {
      video.pause();
      video.src = '';
      video.load();
      setVideoElement(null);
    };
  }, [camConfig]);

  if (!camConfig) {
    return (
      <div className="p-4 text-center">
        <h2 className="text-xl font-bold mb-2">No Camera Configuration Found</h2>
        <p>Please set up your camera first by going to the Setup page.</p>
      </div>
    );
  }

  const renderSize = [
    camConfig.machineBounds[1][0] - camConfig.machineBounds[0][0],
    camConfig.machineBounds[1][1] - camConfig.machineBounds[0][1]
  ];
  const [canvasW, canvasH] = renderSize;

  return (
    <div className="p-2">
      <div style={{ width: canvasW, height: canvasH }}>
        <Canvas
          orthographic
          camera={{
            position: [0, 0, 10],
            left: 0,
            right: canvasW,
            top: 0,
            bottom: canvasH,
            near: -1000,
            far: 1000
          }}
          gl={{ antialias: true, outputColorSpace: THREE.SRGBColorSpace }}
        >
          {videoElement && <Scene video={videoElement} camConfig={camConfig} />}
        </Canvas>
      </div>
    </div>
  );
}

function Scene({ video, camConfig }: SceneProps) {
  const { scene } = useThree();
  const [imgWidth, imgHeight] = camConfig.dimensions;
  const meshRef = useRef<THREE.Mesh>(null);
  const planeRef = useRef<THREE.PlaneGeometry>(null);

  // Translate plane geometry - equivalent to planeGeom.translate(imgWidth / 2, imgHeight / 2, 0);
  useEffect(() => {
    if (planeRef.current) {
      planeRef.current.translate(imgWidth / 2, imgHeight / 2, 0);
    }
  }, [imgWidth, imgHeight]);

  useEffect(() => {
    if (!meshRef.current) return;

    // Compute homography and apply it
    const mp = camConfig.machineBounds;
    const dstPoints = [[mp[0][0], mp[0][1]], [mp[1][0], mp[0][1]], [mp[1][0], mp[1][1]], [mp[0][0], mp[1][1]]] as IBox;
    const H = computeHomography(camConfig.machineBoundsInCam, dstPoints);
    const M = buildMatrix4FromHomography(H);

    // Apply matrix to mesh
    meshRef.current.matrixAutoUpdate = false;
    meshRef.current.matrix.fromArray(M);
    meshRef.current.matrix.decompose(
      meshRef.current.position,
      meshRef.current.quaternion,
      meshRef.current.scale
    );
  }, [camConfig]);

  // Create video texture
  const videoTexture = new THREE.VideoTexture(video);
  videoTexture.minFilter = THREE.LinearFilter;
  videoTexture.magFilter = THREE.LinearFilter;
  videoTexture.colorSpace = THREE.SRGBColorSpace;
  videoTexture.flipY = false;

  return (
    <>
      <OrbitControls
        enableRotate={false}
        mouseButtons={{
          LEFT: THREE.MOUSE.PAN,
          MIDDLE: THREE.MOUSE.DOLLY,
          RIGHT: THREE.MOUSE.PAN
        }}
        enableDamping={true}
        dampingFactor={0.25}
        minZoom={1}
        maxZoom={10}
      />

      <mesh ref={meshRef}>
        <planeGeometry
          ref={planeRef}
          args={[imgWidth, imgHeight, 1, 1]}
          attach="geometry"
        />
        <meshBasicMaterial
          map={videoTexture}
          side={THREE.DoubleSide}
          attach="material"
        />
      </mesh>
    </>
  );
}