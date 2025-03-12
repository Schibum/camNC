import { useViewportToWorldScale } from '@/calibration/scaleHooks';
import { OrbitControls, Text } from '@react-three/drei';
import { Canvas, useThree } from '@react-three/fiber';
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

function DefaultControls() {
  const minZoom = useViewportToWorldScale();
  const camera = useThree(state => state.camera);
  camera.zoom = minZoom;
  camera.updateProjectionMatrix();

  return (
    <OrbitControls
      enableRotate={false}
      enablePan={true}
      enableZoom={true}
      minZoom={minZoom}
      maxZoom={minZoom * maxZoomFactor}
    />
  );
}

export const PresentCanvas = ({ children }: { children: React.ReactNode }) => {
  return (
    <Canvas
      orthographic
      camera={{ near: -1000, far: 1000 }}
      gl={{ antialias: true, outputColorSpace: THREE.SRGBColorSpace }}
    >
      <color attach="background" args={[0x1111ff]} />
      <DefaultControls />
      <ErrorBoundary FallbackComponent={FallbackContent}>{children}</ErrorBoundary>
    </Canvas>
  );
};
