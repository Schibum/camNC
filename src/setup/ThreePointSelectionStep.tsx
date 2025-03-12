import { UnskewedVideoMesh } from '@/calibration/UnskewTsl';
import { useViewportToWorldScale } from '@/calibration/scaleHooks';
import { Draggable } from '@/scene/Draggable';
import { Line } from '@react-three/drei';
import { ThreeEvent } from '@react-three/fiber';
import React, { useCallback, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { IBox, ITuple, useStore } from '../store';
import { ActionButtons } from './ActionButtons';
import { NextPointNotification } from './NextPointNotification';
import { PresentCanvas } from '@/scene/PresentCanvas';

interface PointSelectionStepProps {}

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
function PointsScene({
  points,
  setPoints,
}: {
  points: ITuple[];
  setPoints: (points: ITuple[]) => void;
}) {
  const meshRef = useRef<THREE.Mesh>(null);
  const videoSize = useStore(state => state.cameraConfig.dimensions);
  const [isDragging, setIsDragging] = useState(false);
  const videoToWorldScale = useViewportToWorldScale();
  // Handle placing a new point by clicking on the mesh
  const handlePlacePoint = ({ point, ...e }: ThreeEvent<MouseEvent>) => {
    if (points.length >= 4) return;

    // Stop event propagation
    e.stopPropagation();

    const worldPoint = point.clone().divideScalar(videoToWorldScale);
    // Get intersection point on the mesh
    console.log('intersectionPoint', worldPoint.x, worldPoint.y);

    setPoints([...points, [worldPoint.x, worldPoint.y]]);
  };

  // Convert from video coordinates to Three.js mesh coordinates
  const videoToMeshCoords = useCallback(
    (x: number, y: number): [number, number, number] => {
      return [x * videoToWorldScale, y * videoToWorldScale, 0.01]; // Put points slightly in front of the mesh
    },
    [videoToWorldScale]
  );

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
    if (meshRef.current) {
      const newPoints = [...points];
      newPoints[index] = [position.x / videoToWorldScale, position.y / videoToWorldScale];
      setPoints(newPoints);
    }
  };

  // Render the UnskewedVideoMesh and the points
  return (
    <>
      {/* Use primitive to properly attach the ref and event handlers */}
      <UnskewedVideoMesh ref={meshRef} />

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
            }}
          >
            <Crosshair
              position={[0, 0, 0]}
              color={index % 2 === 0 ? '#4287f5' : '#f54242'}
              size={7}
            />
          </Draggable>
        );
      })}

      {/* Draw connection lines between points */}
      {points.length === 4 && !isDragging && (
        <Line points={linePoints} color="yellow" lineWidth={2} />
      )}
    </>
  );
}

export const ThreePointSelectionStep: React.FC<PointSelectionStepProps> = ({}) => {
  const [points, setPoints] = useState<ITuple[]>([]);
  const setMachineBoundsInCam = useStore(state => state.setMachineBoundsInCam);

  // Handle saving points
  const handleSave = () => {
    if (points.length !== 4) {
      console.error('Must select exactly 4 points');
      return;
    }
    console.log('points', points);

    setMachineBoundsInCam(points as IBox);
  };

  return (
    <div className="point-selection-step">
      <h2>Step 2: Select Reference Points</h2>
      <p>
        Click on the video to place 4 reference points. You can drag crosshairs to adjust positions.
      </p>

      {/* Notification about which point to select next */}
      <div style={{ position: 'relative' }}>
        <NextPointNotification pointCount={points.length} />

        {/* Canvas container */}
        <div
          style={{
            position: 'relative',
            width: '800px',
            height: '450px',
            backgroundColor: '#000',
          }}
        >
          <PresentCanvas>
            <PointsScene points={points} setPoints={setPoints} />

            <Draggable position={[0, 0, 0]}>
              <mesh>
                <boxGeometry args={[10, 10, 1]} />
                <meshBasicMaterial color="red" />
              </mesh>
            </Draggable>
          </PresentCanvas>
        </div>
      </div>

      {/* Action buttons for reset and save */}
      <ActionButtons
        onReset={() => null}
        onSave={handleSave}
        canSave={points.length === 4}
        saveDisabled={false}
      />
    </div>
  );
};
