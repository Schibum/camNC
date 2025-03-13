import { Text } from '@react-three/drei';
import React from 'react';
import * as THREE from 'three';

interface ZHeightGradientProps {
  cuttingZHeights: number[];
  getColorForZ: (zHeight: number) => THREE.Color;
}

const ZHeightGradient: React.FC<ZHeightGradientProps> = ({ cuttingZHeights, getColorForZ }) => {
  if (cuttingZHeights.length <= 1) return null;

  return (
    <group position={[0, -55, 0]}>
      {/* Create 10 color boxes to visualize the gradient */}
      {Array.from({ length: 10 }).map((_, i) => {
        const t = i / 9; // Normalized position in range [0,1]
        const zValue =
          cuttingZHeights[0] +
          t * (cuttingZHeights[cuttingZHeights.length - 1] - cuttingZHeights[0]);
        return (
          <mesh key={`gradient-${i}`} position={[15 + i * 5, 0, 0]}>
            <planeGeometry args={[5, 10]} />
            <meshBasicMaterial color={getColorForZ(zValue)} />
          </mesh>
        );
      })}
      <Text position={[10, 0, 0.1]} fontSize={10} color="white" anchorX="right">
        {cuttingZHeights[0].toFixed(2)}
      </Text>
      <Text position={[65, 0, 0.1]} fontSize={10} color="white" anchorX="left">
        {cuttingZHeights[cuttingZHeights.length - 1].toFixed(2)}
      </Text>
    </group>
  );
};

interface ZHeightLegendProps {
  cuttingZHeights: number[];
  getColorForZ: (zHeight: number) => THREE.Color;
}

const ZHeightLegend: React.FC<ZHeightLegendProps> = ({ cuttingZHeights, getColorForZ }) => {
  return (
    <>
      <Text position={[0, -40, 0]} fontSize={15} color="white" anchorX="left">
        Z-Heights (Cutting Only):
      </Text>

      <ZHeightGradient cuttingZHeights={cuttingZHeights} getColorForZ={getColorForZ} />

      {/* Individual z-height entries */}
      {cuttingZHeights.map((height, index) => (
        <group key={`z-height-${index}`} position={[0, -75 - index * 15, 0]}>
          <mesh position={[7.5, 0, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[2, 2, 15, 8, 1]} />
            <meshStandardMaterial color={getColorForZ(height)} />
          </mesh>
          <Text position={[25, 0, 0]} fontSize={12} color="white" anchorX="left">
            Z = {height.toFixed(3)}
          </Text>
        </group>
      ))}
    </>
  );
};

interface ToolpathLegendProps {
  bounds: {
    min: THREE.Vector2;
    max: THREE.Vector2;
    size: THREE.Vector2;
  };
  cuttingZHeights: number[];
  getColorForZ: (zHeight: number) => THREE.Color;
  showRapidMoves: boolean;
  onToggleRapidMoves: () => void;
}

export const ToolpathLegend: React.FC<ToolpathLegendProps> = ({
  bounds,
  cuttingZHeights,
  getColorForZ,
  showRapidMoves,
  onToggleRapidMoves,
}) => {
  return (
    <group position={[bounds.max.x - 50, bounds.max.y - 20, 100]}>
      {/* Rapid move legend */}
      <group
        position={[0, 0, 0]}
        onClick={onToggleRapidMoves}
        onPointerOver={() => (document.body.style.cursor = 'pointer')}
        onPointerOut={() => (document.body.style.cursor = 'default')}
      >
        <mesh position={[7.5, 0, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[2, 2, 15, 8, 1]} />
          <meshStandardMaterial
            color="rgb(0, 128, 0)"
            opacity={showRapidMoves ? 1 : 0.3}
            transparent
          />
        </mesh>
        <Text
          position={[25, 0, 0]}
          fontSize={15}
          color={showRapidMoves ? 'white' : 'gray'}
          anchorX="left"
        >
          Rapid Move (G0) {showRapidMoves ? '[ON]' : '[OFF]'}
        </Text>
      </group>

      {/* Cutting move legend */}
      <mesh position={[7.5, -20, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[3, 3, 15, 8, 1]} />
        <meshStandardMaterial color="white" />
      </mesh>
      <Text position={[25, -20, 0]} fontSize={15} color="white" anchorX="left">
        Cutting Move (G1/G2/G3)
      </Text>

      {/* Z-height legend */}
      <ZHeightLegend cuttingZHeights={cuttingZHeights} getColorForZ={getColorForZ} />
    </group>
  );
};
