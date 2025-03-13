import { useMachineSize } from '@/store';
import { Line, Text } from '@react-three/drei';
import React, { useMemo, useState } from 'react';
import * as THREE from 'three';
import {
  extractToolsFromGCode,
  parseGCode,
  generateArcPoints,
  groupSegmentsByTool,
} from '@/visualize/gcodeHelpers';

interface GCodeVisualizerProps {
  gcode: string;
}

export const GCodeVisualizer: React.FC<GCodeVisualizerProps> = ({ gcode }) => {
  const [error, setError] = useState<string | null>(null);
  const machineSize = useMachineSize();
  const offsetX = machineSize[0] / 2;
  const offsetY = machineSize[1] / 2;

  // Extract tool information from the GCode comments
  const tools = useMemo(() => extractToolsFromGCode(gcode), [gcode]);

  // Parse the GCode and extract the toolpath
  const {
    toolpathSegments,
    bounds,
    error: parseError,
  } = useMemo(() => {
    const result = parseGCode(gcode);
    if (result.error) {
      setError(result.error);
    } else {
      setError(null);
    }
    return result;
  }, [gcode]);

  // Group segments by tool and motion type for optimization
  const segmentsByTool = useMemo(() => groupSegmentsByTool(toolpathSegments), [toolpathSegments]);

  return (
    <group position={[-offsetX, -offsetY, 0.1]}>
      {error && (
        <mesh position={[0, 0, 1]}>
          <planeGeometry args={[200, 50]} />
          <meshBasicMaterial color="red" transparent opacity={0.7} />
          <Text position={[0, 0, 0.1]} fontSize={10} color="white">
            {error}
          </Text>
        </mesh>
      )}

      {/* Legend */}
      <group position={[bounds.max.x - 50, bounds.max.y - 20, 0.2]}>
        <Line
          points={[new THREE.Vector3(0, 0, 0), new THREE.Vector3(15, 0, 0)]}
          color="rgb(0, 128, 0)"
          lineWidth={2}
        />
        <Text position={[25, 0, 0]} fontSize={15} color="white" anchorX="left">
          Rapid Move (G0)
        </Text>

        <Line
          points={[new THREE.Vector3(0, -20, 0), new THREE.Vector3(15, -20, 0)]}
          color="hsl(0, 70%, 50%)"
          lineWidth={5}
        />
        <Text position={[25, -20, 0]} fontSize={15} color="white" anchorX="left">
          Cutting Move (G1/G2/G3)
        </Text>
      </group>

      {/* Tool paths */}
      {Object.entries(segmentsByTool).map(([toolNumberStr, segments]) => {
        const toolNumber = parseInt(toolNumberStr, 10);
        const tool = tools[toolNumberStr] || { diameter: 6, color: 'white' };

        return (
          <group key={`tool-${toolNumber}`}>
            {/* Render rapid movements */}
            {segments.rapid.map((segment, idx) => {
              if (segment.isArc) {
                const arcPoints = generateArcPoints(segment);
                return (
                  <Line
                    key={`rapid-arc-${idx}`}
                    points={arcPoints}
                    color="rgb(0, 128, 0)" // Green for rapid moves
                    lineWidth={tool.diameter} // Thinner for rapid moves
                    worldUnits
                  />
                );
              } else {
                // Regular line segment
                return (
                  <Line
                    key={`rapid-line-${idx}`}
                    points={[
                      new THREE.Vector3(segment.v1.x, segment.v1.y, segment.v1.z),
                      new THREE.Vector3(segment.v2.x, segment.v2.y, segment.v2.z),
                    ]}
                    color="rgb(0, 128, 0)" // Green for rapid moves
                    lineWidth={tool.diameter} // Thinner for rapid moves
                    worldUnits
                  />
                );
              }
            })}

            {/* Render cutting movements */}
            {segments.cutting.map((segment, idx) => {
              if (segment.isArc) {
                const arcPoints = generateArcPoints(segment);
                return (
                  <Line
                    key={`cutting-arc-${idx}`}
                    points={arcPoints}
                    color={tool.color}
                    lineWidth={tool.diameter}
                    worldUnits
                  />
                );
              } else {
                // Regular line segment
                return (
                  <Line
                    key={`cutting-line-${idx}`}
                    points={[
                      new THREE.Vector3(segment.v1.x, segment.v1.y, segment.v1.z),
                      new THREE.Vector3(segment.v2.x, segment.v2.y, segment.v2.z),
                    ]}
                    color={tool.color}
                    lineWidth={tool.diameter}
                    worldUnits
                  />
                );
              }
            })}
          </group>
        );
      })}
    </group>
  );
};
