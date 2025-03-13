import { useViewportToVideoScale, useViewPortToMachineScale } from '@/calibration/scaleHooks';
import { OrbitControls, Text } from '@react-three/drei';
import { Canvas, useThree } from '@react-three/fiber';
import { useEffect } from 'react';
import { ErrorBoundary } from 'react-error-boundary';
import * as THREE from 'three';

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

function DefaultControls({ worldScale }: { worldScale: IWorldScale }) {
  const minZoom = worldScale === 'video' ? useViewportToVideoScale() : useViewPortToMachineScale();
  const camera = useThree(state => state.camera);
  useEffect(() => {
    camera.zoom = minZoom;
    camera.updateProjectionMatrix();
    // only set initial zoom once
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <OrbitControls
      enableRotate={true}
      enablePan={true}
      enableZoom={true}
      minZoom={minZoom}
      maxZoom={minZoom * maxZoomFactor}
    />
  );
}

export const PresentCanvas = ({
  worldScale = 'video',
  children,
}: {
  worldScale?: IWorldScale;
  children: React.ReactNode;
}) => {
  return (
    <Canvas
      orthographic
      camera={{ near: -1000, far: 1000 }}
      gl={{ antialias: true, outputColorSpace: THREE.SRGBColorSpace }}
    >
      <color attach="background" args={[0x1111ff]} />
      <DefaultControls worldScale={worldScale} />
      <ErrorBoundary FallbackComponent={FallbackContent}>{children}</ErrorBoundary>
    </Canvas>
  );
};
