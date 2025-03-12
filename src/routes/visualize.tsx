import { UnskewedVideoMesh } from '@/calibration/UnskewTsl';
import { OrbitControls } from '@react-three/drei';
import { useThree } from '@react-three/fiber';
import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { Matrix4, Vector3 } from 'three';
import { buildMatrix4FromHomography, computeHomography } from '../math/perspectiveTransform';
import { useStore, type IBox } from '../store';
import { PresentCanvas } from '@/scene/PresentCanvas';

export const Route = createFileRoute('/visualize')({
  component: VisualizeComponent,
});

// Add type for camConfig if needed
interface SceneProps {
  video: HTMLVideoElement;
  camConfig: any; // Replace with actual type if available
}

function VisualizeComponent() {
  const camConfig = useStore(state => state.cameraConfig);
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
    camConfig.machineBounds[1][1] - camConfig.machineBounds[0][1],
  ];
  const [canvasW, canvasH] = renderSize;

  return (
    <div className="p-2">
      <div style={{ width: canvasW, height: canvasH }}>
        <PresentCanvas>
          <color attach="background" args={[0x1111ff]} />
          {videoElement && <Scene video={videoElement} camConfig={camConfig} />}
        </PresentCanvas>
      </div>
    </div>
  );
}

function Scene({ video, camConfig }: SceneProps) {
  const { scene } = useThree();
  const [imgWidth, imgHeight] = camConfig.dimensions;
  const meshRef = useRef<THREE.Mesh>(null);
  const planeRef = useRef<THREE.PlaneGeometry>(null);

  useEffect(() => {
    if (planeRef.current) {
      // Remove this translation as we're now working in three.js coordinates
      // planeRef.current.translate(imgWidth / 2, imgHeight / 2, 0);
    }
  }, [imgWidth, imgHeight]);

  useEffect(() => {
    if (!meshRef.current) return;

    // Compute homography and apply it
    const mp = camConfig.machineBounds;
    const dstPoints = [
      [mp[0][0], mp[0][1]],
      [mp[1][0], mp[0][1]],
      [mp[1][0], mp[1][1]],
      [mp[0][0], mp[1][1]],
    ] as IBox;
    const H = computeHomography(camConfig.machineBoundsInCam, dstPoints);
    const M = new Matrix4().fromArray(buildMatrix4FromHomography(H));

    // toCv transforms from three.js coords to image coords:
    // - Translate origin from center to top-left
    // - Flip y-axis (in image coords y increases downward)
    const toCv = new Matrix4()
      .makeTranslation(imgWidth / 2, imgHeight / 2, 0)
      .scale(new Vector3(1, -1, 1));

    // toThree transforms from image coords to three.js coords
    const toThree = toCv.clone().invert();

    // Complete transformation: three.js -> image -> apply homography -> three.js
    const homographyThree = toThree.multiply(M).multiply(toCv);

    // Apply matrix to mesh - using homographyThree instead of M
    meshRef.current.matrixAutoUpdate = false;
    meshRef.current.matrix.copy(homographyThree);
    meshRef.current.matrix.decompose(
      meshRef.current.position,
      meshRef.current.quaternion,
      meshRef.current.scale
    );
  }, [camConfig, imgWidth, imgHeight]);

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
          RIGHT: THREE.MOUSE.PAN,
        }}
        enableDamping
        dampingFactor={0.25}
        minZoom={0.5}
        maxZoom={10}
      />

      <UnskewedVideoMesh ref={meshRef} />
    </>
  );
}
