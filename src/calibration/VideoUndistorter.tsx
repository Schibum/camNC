import React, { Suspense } from 'react';
import { Canvas } from '@react-three/fiber';
import { Html, OrbitControls, OrthographicCamera } from '@react-three/drei';
import * as THREE from 'three';
import { UnskewedVideoMesh } from './UnskewTsl';

const VideoUndistorter: React.FC<{}> = ({}) => {
  return (
    <>
      <div className="flex flex-col gap-4 h-screen">
        {/* Three.js scene with React Three Fiber */}
        {
          <Canvas>
            <OrthographicCamera makeDefault position={[0, 0, 1.5]} zoom={1} near={0.1} far={100}>
              <color attach="background" args={[0x1111ff]} />
            </OrthographicCamera>

            <Suspense fallback={<Html>Loading Plane...</Html>}>
              <UnskewedVideoMesh />
            </Suspense>

            <gridHelper
              args={[2000, 20, 0x555555, 0x333333]}
              rotation={[Math.PI / 2, 0, 0]}
              position={[0, 0, -0.01]}
            />

            <Html transform position={[0, 0, 1.5]} distanceFactor={1000}>
              <div>
                <p>Hello</p>
              </div>
            </Html>

            <OrbitControls
              enableDamping
              enableRotate={false}
              dampingFactor={0.25}
              screenSpacePanning={true}
              minZoom={0.95}
              maxZoom={10}
              zoomSpeed={2.0}
              mouseButtons={{
                LEFT: THREE.MOUSE.PAN,
              }}
              makeDefault
            />
          </Canvas>
        }
      </div>

      <div className="controls">
        <p className="controls-info">
          Use mouse to interact: Left click + drag to rotate, Right click + drag to pan, Scroll to
          zoom
        </p>
      </div>
    </>
  );
};

export default VideoUndistorter;
