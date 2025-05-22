import { useViewPortToMachineScale, useViewportToVideoScale } from '@/calibration/scaleHooks';
import { LoadingVideoOverlay } from '@/components/LoadingVideoOverlay';
import { useMachineSize } from '@/store';
import { OrbitControls, Text } from '@react-three/drei';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Suspense, useEffect, useMemo, useRef } from 'react';
import { ErrorBoundary } from 'react-error-boundary';
import * as THREE from 'three';
import { OrbitControls as OrbitControlsImpl } from 'three-stdlib';

const maxZoomFactor = 10;

// Fallback content for when the Three.js component errors
const FallbackContent = ({ error }: { error: Error }) => (
  <mesh>
    <planeGeometry args={[2, 2]} />
    <meshBasicMaterial color="red" />
    <Text position={[0, 0, 0.1]} fontSize={0.1} color="white">
      {error.message || 'Error loading video texture'}
    </Text>
  </mesh>
);

type IWorldScale = 'video' | 'machine';

function useDefaultCameraRotation(worldScale: IWorldScale) {
  return useMemo(() => new THREE.Euler(0, 0, worldScale === 'machine' ? -Math.PI / 2 : 0), [worldScale]);
}

function DefaultControls({ worldScale }: { worldScale: IWorldScale }) {
  // Call both hooks unconditionally
  const videoScale = useViewportToVideoScale();
  const machineScale = useViewPortToMachineScale();
  const machineSize = useMachineSize();
  // Then select which value to use
  const minZoom = worldScale === 'video' ? videoScale : machineScale;
  const zoomOutFactor = worldScale === 'video' ? 1 : 0.9;

  const camera = useThree(state => state.camera);
  const rotation = useDefaultCameraRotation(worldScale);
  const orbitRef = useRef<OrbitControlsImpl>(null);

  useEffect(() => {
    if (worldScale === 'machine') {
      camera.position.set(machineSize.x / 2, machineSize.y / 2, 1500);
    }
  }, [camera, machineSize, worldScale]);

  // Hack, override orbit controls camera rotation. It'll always set it back to
  // the default rotation otherwise.
  useFrame(() => {
    camera.rotation.copy(rotation);
    // camera.lookAt(1000, 1000, 0);
  });

  useEffect(() => {
    camera.zoom = minZoom;
    THREE.Object3D.DEFAULT_UP.set(0, 0, 1);
    camera.rotation.copy(rotation);
    camera.updateProjectionMatrix();

    // only set initial zoom once
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!orbitRef.current) return;
    orbitRef.current.zoomToCursor = true;
    orbitRef.current.touches = {
      ONE: THREE.TOUCH.ROTATE,
      TWO: THREE.TOUCH.PAN,
    };
    orbitRef.current.mouseButtons = {
      LEFT: THREE.MOUSE.ROTATE,
      RIGHT: THREE.MOUSE.PAN,
    };
  }, []);

  return (
    <OrbitControls
      ref={orbitRef}
      keyEvents={true}
      makeDefault
      dampingFactor={0.25}
      enableRotate={false}
      enablePan={true}
      enableZoom={true}
      minZoom={minZoom * zoomOutFactor}
      maxZoom={minZoom * maxZoomFactor}
    />
  );
}

export const PresentCanvas = ({ worldScale = 'video', children }: { worldScale?: IWorldScale; children: React.ReactNode }) => {
  return (
    <div className="w-full h-full">
      <Suspense fallback={<LoadingVideoOverlay />}>
        <Canvas
          orthographic
          camera={{
            near: -10000,
            far: 10000,
            position: [0, 0, 1500],
          }}
          raycaster={{ near: -10000, far: 10000 }}
          gl={{ antialias: true, outputColorSpace: THREE.SRGBColorSpace }}>
          <ambientLight intensity={1} />
          {/* <directionalLight position={[10, 10, 10]} intensity={0.5} /> */}
          <DefaultControls worldScale={worldScale} />
          <ErrorBoundary FallbackComponent={FallbackContent}>{children}</ErrorBoundary>
        </Canvas>
      </Suspense>
    </div>
  );
};
