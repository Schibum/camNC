import React from 'react';
import * as THREE from 'three';

interface ToolpathsProps {
  toolpathGeometries: Record<
    string,
    { rapid: THREE.ShapeGeometry[]; cutting: THREE.ShapeGeometry[] }
  >;
  zScaleFactor: number;
  getColorForZ: (zHeight: number) => THREE.Color;
  showRapidMoves: boolean;
  showCuttingMoves: boolean;
}

export const Toolpaths: React.FC<ToolpathsProps> = ({
  toolpathGeometries,
  zScaleFactor,
  getColorForZ,
  showRapidMoves,
  showCuttingMoves,
}) => {
  return (
    <>
      {Object.entries(toolpathGeometries).map(([toolNumberStr, geometries]) => {
        const toolNumber = parseInt(toolNumberStr, 10);

        return (
          <group key={`tool-${toolNumber}`}>
            {/* Render rapid movements */}
            {showRapidMoves &&
              geometries.rapid.map((geometry, idx) => {
                const zHeight = geometry.userData?.zHeight || 0.1;

                return (
                  <mesh
                    key={`rapid-${toolNumber}-${idx}`}
                    position={[0, 0, zHeight * zScaleFactor]}
                  >
                    <primitive object={geometry} attach="geometry" />
                    <meshStandardMaterial
                      color="rgb(0, 128, 0)"
                      side={THREE.DoubleSide}
                      transparent
                      opacity={0.5}
                    />
                  </mesh>
                );
              })}

            {/* Render cutting movements */}
            {showCuttingMoves &&
              geometries.cutting.map((geometry, idx) => {
                const zHeight = geometry.userData?.zHeight || 0.1;

                return (
                  <mesh
                    key={`cutting-${toolNumber}-${idx}`}
                    position={[0, 0, zHeight * zScaleFactor]}
                  >
                    <primitive object={geometry} attach="geometry" />
                    <meshStandardMaterial color={getColorForZ(zHeight)} side={THREE.DoubleSide} />
                  </mesh>
                );
              })}
          </group>
        );
      })}
    </>
  );
};
