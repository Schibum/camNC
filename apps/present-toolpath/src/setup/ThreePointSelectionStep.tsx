import { useReprojectedMachineBounds, useUpdateCameraExtrinsics } from '@/calibration/solveP3P';
import { UnskewedVideoMesh } from '@/calibration/UnskewTsl';
import { Draggable } from '@/scene/Draggable';
import { PresentCanvas } from '@/scene/PresentCanvas';
import { Line, Text } from '@react-three/drei';
import { ThreeEvent } from '@react-three/fiber';
import { Button } from '@wbcnc/ui/components/button';
import { PageHeader } from '@wbcnc/ui/components/page-header';
import React, { useCallback, useMemo, useState } from 'react';
import * as THREE from 'three';
import { IMachineBounds, ITuple, useStore } from '../store';
import { MachineBoundsInput } from './MachineBoundsDialog';

interface PointSelectionStepProps {}

function ReprojectedMachineBounds() {
  const reprojectedPoints = useReprojectedMachineBounds();
  return (
    <>
      {reprojectedPoints.map((point, index) => {
        return (
          <mesh key={index} position={[point.x, point.y, 0.1]}>
            <ringGeometry args={[3, 4, 16]} />
            <meshBasicMaterial color="hotpink" wireframe={false} side={THREE.DoubleSide} />
          </mesh>
        );
      })}
    </>
  );
}

const kPointLabels = ['1: (xmin, ymin)', '2: (xmin, ymax)', '3: (xmax, ymax)', '4: (xmax, ymin)'];

const NextPointHint: React.FC<{ pointCount: number }> = ({ pointCount }) => {
  if (pointCount >= 4) {
    return null;
  }

  const getNextPointLabel = () => {
    return pointCount < 4 ? kPointLabels[pointCount] : null;
  };

  return <div>Select position of {getNextPointLabel()}</div>;
};

// A crosshair component to show at each point
const Crosshair: React.FC<{
  position: [number, number, number];
  color: string;
  size?: number;
}> = ({ position, color, size = 5 }) => {
  return (
    <group position={position}>
      <mesh>
        <planeGeometry args={[2 * size, 2 * size]} />
        <meshBasicMaterial color="green" transparent opacity={0} />
      </mesh>
      <Line
        // onClick={stop}
        points={[
          [-size, 0, 0],
          [size, 0, 0],
        ]} // Array of points, Array<Vector3 | Vector2 | [number, number, number] | [number, number] | number>
        color="red" // Default
        lineWidth={1}
      />
      <Line
        // onClick={stop}
        points={[
          [0, -size, 0],
          [0, size, 0],
        ]} // Array of points, Array<Vector3 | Vector2 | [number, number, number] | [number, number] | number>
        color="red" // Default
        lineWidth={1}
      />
    </group>
  );
};

// Component to render and interact with points
function PointsScene({ points, setPoints }: { points: ITuple[]; setPoints: (points: ITuple[]) => void }) {
  const videoSize = useStore(state => state.cameraConfig.dimensions);
  const [isDragging, setIsDragging] = useState(false);
  // Handle placing a new point by clicking on the mesh
  const handlePlacePoint = ({ point, ...e }: ThreeEvent<MouseEvent>) => {
    if (points.length >= 4) return;

    // Stop event propagation
    e.stopPropagation();

    setPoints([...points, [point.x, point.y]]);
  };

  // Convert from video coordinates to Three.js mesh coordinates
  const videoToMeshCoords = useCallback((x: number, y: number): [number, number, number] => {
    return [x, y, 0.01]; // Put points slightly in front of the mesh
  }, []);

  // Create line points for the calibration rectangle
  const linePoints = useMemo(() => {
    if (points.length !== 4) return [];

    return [
      ...points.map(p => new THREE.Vector3(...videoToMeshCoords(p[0], p[1]))),
      new THREE.Vector3(...videoToMeshCoords(points[0][0], points[0][1])), // Close the loop
    ];
  }, [points, videoToMeshCoords]);

  // Handle point drag end
  const handlePointDragEnd = (index: number, position: THREE.Vector3) => {
    console.log('handlePointDragEnd', index, position);

    const x = position.x + videoSize[0] / 2;
    // Convert Y from [height/2, -height/2] to [0, height]
    const y = videoSize[1] / 2 - position.y;
    console.log('img pos', x, y, videoSize);
    const newPoints = [...points];
    newPoints[index] = [position.x, position.y];
    setPoints(newPoints);
  };

  // Render the UnskewedVideoMesh and the points
  return (
    <>
      {/* Use primitive to properly attach the ref and event handlers */}
      <UnskewedVideoMesh />

      {/* Add a transparent plane overtop for click handling */}
      <mesh position={[0, 0, 0.005]} onClick={handlePlacePoint}>
        <planeGeometry args={[videoSize[0], videoSize[1]]} />
        <meshBasicMaterial transparent opacity={0} />
      </mesh>

      {/* Render points as draggable crosshairs */}
      {points.map((point, index) => {
        const [x, y, z] = videoToMeshCoords(point[0], point[1]);
        return (
          <Draggable
            key={index}
            position={[x, y, z]}
            onDragStart={event => {
              setIsDragging(true);
            }}
            onDragEnd={event => {
              const worldPosition = new THREE.Vector3();
              event.eventObject.getWorldPosition(worldPosition);
              handlePointDragEnd(index, worldPosition);
              setIsDragging(false);
            }}>
            <Crosshair position={[0, 0, 0]} color={index % 2 === 0 ? '#4287f5' : '#f54242'} size={25} />
            <Text
              fontSize={40}
              color="white"
              outlineColor="black"
              outlineWidth={1}
              outlineBlur={1}
              anchorX="center"
              anchorY="middle"
              position={[0, 50, 0]}>
              {kPointLabels[index]}
            </Text>
          </Draggable>
        );
      })}

      {/* Draw connection lines between points */}
      {points.length === 4 && !isDragging && <Line points={linePoints} color="yellow" lineWidth={2} />}

      {points.length === 4 && !isDragging && <ReprojectedMachineBounds />}
    </>
  );
}

export const ThreePointSelectionStep: React.FC<PointSelectionStepProps> = ({}) => {
  const [points, setPoints] = useState<ITuple[]>(useStore(state => state.cameraConfig.machineBoundsInCam));
  const setMachineBoundsInCam = useStore(state => state.setMachineBoundsInCam);
  const updateCameraExtrinsics = useUpdateCameraExtrinsics();

  // Handle saving points
  const handleSave = () => {
    if (points.length !== 4) {
      console.error('Must select exactly 4 points');
      return;
    }
    console.log('points', points);

    setMachineBoundsInCam(points as IMachineBounds);
    updateCameraExtrinsics();
  };

  const handleReset = () => {
    setPoints([]);
  };

  return (
    <div className="w-full h-dvh flex flex-col gap-1 overflow-hidden">
      <PageHeader title="Machine Bounds" className="absolute" />

      <div className="flex-1 overflow-hidden">
        <PresentCanvas>
          <PointsScene points={points} setPoints={setPoints} />
        </PresentCanvas>
      </div>

      <div className="absolute bottom-4 right-4 flex items-center justify-end gap-2 p-2 bg-white/80 rounded-lg shadow-sm">
        <NextPointHint pointCount={points.length} />
        <MachineBoundsInput />
        {/* Action buttons for reset and save */}
        <Button variant="secondary" onClick={handleReset}>
          Reset
        </Button>
        <Button onClick={handleSave} disabled={points.length !== 4}>
          Save
        </Button>
      </div>
    </div>
  );
};
