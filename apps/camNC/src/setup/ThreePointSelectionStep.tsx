import { UnskewedVideoMeshWithLoading } from '@/calibration/UnskewTsl';
import { Draggable } from '@/scene/Draggable';
import { PresentCanvas } from '@/scene/PresentCanvas';
import { updateCameraExtrinsics, useReprojectedMachineBounds } from '@/store/store-p3p';
import { Line, Text } from '@react-three/drei';
import { ThreeEvent } from '@react-three/fiber';
import { useNavigate } from '@tanstack/react-router';
import { Button } from '@wbcnc/ui/components/button';
import { PageHeader } from '@wbcnc/ui/components/page-header';
import { toast } from '@wbcnc/ui/components/sonner';
import React, { Suspense, useMemo, useState } from 'react';
import * as THREE from 'three';
import { Vector2, Vector3 } from 'three';
import { useCamResolution, useStore } from '../store/store';
import { DetectArucosButton } from './DetectArucoButton';
interface PointSelectionStepProps {
  onComplete: () => void;
}

function ReprojectedMachineBounds() {
  const reprojectedPoints = useReprojectedMachineBounds();
  return (
    <>
      {reprojectedPoints.map((point, index) => {
        return (
          <mesh key={index} position={[point.x, point.y, -0.1]}>
            <ringGeometry args={[3, 4, 16]} />
            <meshBasicMaterial color="hotpink" wireframe={false} side={THREE.DoubleSide} />
          </mesh>
        );
      })}
    </>
  );
}

const kPointLabels = [
  'Marker 0: near (xmin, ymin)',
  'Marker 1: near (xmin, ymax)',
  'Marker 2: near (xmax, ymax)',
  'Marker 3: near (xmax, ymin)',
];

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

const videoToMeshCoords = (point: Vector2): Vector3 => {
  return new Vector3(point.x, point.y, -0.01); // Put points slightly in front of the mesh
};

// Component to render and interact with points
function PointsScene({ points, setPoints }: { points: Vector2[]; setPoints: (points: Vector2[]) => void }) {
  const videoSize = useCamResolution();
  const [isDragging, setIsDragging] = useState(false);
  // Handle placing a new point by clicking on the mesh
  const handlePlacePoint = ({ point, ...e }: ThreeEvent<MouseEvent>) => {
    if (points.length >= 4) return;

    // Stop event propagation
    e.stopPropagation();

    setPoints([...points, new Vector2(point.x, point.y)]);
  };

  // Create line points for the calibration rectangle
  const linePoints = useMemo(() => {
    if (points.length !== 4) return [];

    return [
      ...points.map(p => videoToMeshCoords(p)),
      videoToMeshCoords(points[0]), // Close the loop
    ];
  }, [points]);

  // Handle point drag end
  const handlePointDragEnd = (index: number, position: THREE.Vector3) => {
    console.log('handlePointDragEnd', index, position);

    const newPoints = [...points];
    newPoints[index] = new Vector2(position.x, position.y);
    setPoints(newPoints);
  };

  // Render the UnskewedVideoMesh and the points
  return (
    <>
      {/* Use primitive to properly attach the ref and event handlers */}
      <UnskewedVideoMeshWithLoading />

      {/* Add a transparent plane overtop for click handling */}
      <mesh position={[videoSize[0] / 2, videoSize[1] / 2, -0.005]} onClick={handlePlacePoint} rotation={[Math.PI, 0, 0]}>
        <planeGeometry args={[videoSize[0], videoSize[1]]} />
        <meshBasicMaterial transparent opacity={0} />
      </mesh>

      {/* Render points as draggable crosshairs */}
      {points.map((point, index) => {
        const pos = videoToMeshCoords(point);
        return (
          <Draggable
            key={index}
            position={pos}
            rotation={[Math.PI, 0, 0]}
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
            <Suspense>
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
            </Suspense>
          </Draggable>
        );
      })}

      {/* Draw connection lines between points */}
      {points.length === 4 && !isDragging && <Line points={linePoints} color="yellow" lineWidth={2} />}

      {!isDragging && <ReprojectedMachineBounds />}
    </>
  );
}

export const ThreePointSelectionStep: React.FC<PointSelectionStepProps> = ({}) => {
  const [points, setPoints] = useState<Vector2[]>(useStore(state => state.camSource!.markerPosInCam) || []);
  const setMachineBoundsInCam = useStore(state => state.camSourceSetters.setMachineBoundsInCam);
  const navigate = useNavigate();

  // Handle saving points
  const handleSave = () => {
    if (points.length !== 4) {
      console.error('Must select exactly 4 points');
      return;
    }
    console.log('points', points);

    setMachineBoundsInCam(points);
    const reprojectionError = updateCameraExtrinsics();
    toast.success(`Updated camera extrinsics`, {
      description: `Reprojection error: ${reprojectionError.toFixed(2)}px (< 1px is very good)`,
      action: {
        label: 'Go to 2D view',
        onClick: () => navigate({ to: '/' }),
      },
    });
  };

  const handleReset = () => {
    setPoints([]);
  };

  const handleMarkersDetected = (markers: Vector2[]) => {
    if (markers.length !== 4) {
      toast.error('Detected ' + markers.length + ' markers, expected 4, ignoring', {
        position: 'top-right',
      });
      return;
    }
    toast.success('Detected 4 markers', { position: 'top-right' });
    setPoints(markers);
  };

  return (
    <div className="w-full h-dvh flex flex-col gap-1 overflow-hidden">
      <PageHeader title="Markers in Camera" className="absolute" />

      <div className="flex-1 overflow-hidden">
        <PresentCanvas>
          <PointsScene points={points} setPoints={setPoints} />
        </PresentCanvas>
      </div>

      <div className="absolute bottom-4 right-4 flex items-center justify-end gap-2 p-2 bg-white/80 rounded-lg shadow-sm">
        <NextPointHint pointCount={points.length} />
        {/* Action buttons for reset and save */}
        <DetectArucosButton onMarkersDetected={handleMarkersDetected} />
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
