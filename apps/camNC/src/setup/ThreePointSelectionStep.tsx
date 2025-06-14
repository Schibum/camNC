import { UnskewedVideoMesh } from '@/calibration/UnskewTsl';
import { PresentCanvas } from '@/scene/PresentCanvas';
import { updateCameraExtrinsics, useReprojectedMarkerPositions } from '@/store/store-p3p';
import { Line, Text } from '@react-three/drei';
import { useNavigate } from '@tanstack/react-router';
import { Button } from '@wbcnc/ui/components/button';
import { PageHeader } from '@wbcnc/ui/components/page-header';
import { toast } from '@wbcnc/ui/components/sonner';
import React, { Suspense, useMemo, useState } from 'react';
import * as THREE from 'three';
import { Vector2, Vector3 } from 'three';
import { useStore } from '../store/store';
import { DetectArucosButton } from './DetectArucoButton';
import { IMarker } from './detect-aruco';

interface PointSelectionStepProps {
  onComplete: () => void;
}

function ReprojectedMachineBounds() {
  const reprojectedPoints = useReprojectedMarkerPositions();
  if (!reprojectedPoints) return null;
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
        points={[
          [-size, 0, 0],
          [size, 0, 0],
        ]}
        color={color}
        lineWidth={1}
      />
      <Line
        points={[
          [0, -size, 0],
          [0, size, 0],
        ]}
        color={color}
        lineWidth={1}
      />
    </group>
  );
};

// Component to visualize a single aruco marker
const ArucoMarkerVisualization: React.FC<{
  marker: IMarker;
  label: string;
}> = ({ marker, label }) => {
  // Create rectangle outline connecting the corners
  const rectanglePoints = useMemo(() => {
    return [
      ...marker.corners.map(p => videoToMeshCoords(p)),
      videoToMeshCoords(marker.corners[0]), // Close the loop
    ];
  }, [marker.corners]);

  return (
    <group>
      {/* Rectangle outline */}
      <Line points={rectanglePoints} color="hotpink" lineWidth={1} position={[0, 0, -0.1]} />
      {/* Render corner crosshairs */}
      {marker.corners.map((corner, index) => {
        const pos = videoToMeshCoords(corner);
        return <Crosshair key={index} position={[pos.x, pos.y, pos.z]} color={index === 0 ? 'blue' : 'red'} size={10} />;
      })}

      {/* Marker label */}
      <Suspense>
        <Text
          rotation={[Math.PI, 0, 0]}
          fontSize={20}
          color="white"
          outlineColor="black"
          outlineWidth={1}
          outlineBlur={1}
          anchorX="center"
          anchorY="middle"
          // rotation={[Math.PI, 0, 0]}
          position={[marker.corners[0].x, marker.corners[0].y - 30, -0.02]}>
          {label}
        </Text>
      </Suspense>
    </group>
  );
};

const videoToMeshCoords = (point: Vector2): Vector3 => {
  return new Vector3(point.x, point.y, -0.2);
};

// Component for aruco marker visualization
function ArucoPointsScene({ markers }: { markers: IMarker[] }) {
  return (
    <>
      <UnskewedVideoMesh />

      {/* Render aruco markers */}
      {markers.map((marker, index) => {
        const label = index < kPointLabels.length ? kPointLabels[index] : `Marker ${marker.id}`;
        return <ArucoMarkerVisualization key={marker.id} marker={marker} label={label} />;
      })}

      <ReprojectedMachineBounds />
    </>
  );
}

export const ThreePointSelectionStep: React.FC<PointSelectionStepProps> = () => {
  const [markers, setMarkers] = useState<IMarker[]>([]);
  const setMarkerPosInCam = useStore(state => state.camSourceSetters.setMarkerPosInCam);
  const navigate = useNavigate();


  // Handle saving points
  const handleSave = () => {
    const pointsToSave = markers.flatMap(m => m.corners);

    if (pointsToSave.length < 4) {
      console.error('Must select exactly 4 points');
      return;
    }

    setMarkerPosInCam(pointsToSave);
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
    setMarkers([]);
  };

  const handleMarkersDetected = (detectedMarkers: IMarker[]) => {
    if (detectedMarkers.length !== 4) {
      toast.error('Detected ' + detectedMarkers.length + ' markers, expected 4, ignoring', {
        position: 'top-right',
      });
      return;
    }
    toast.success('Detected 4 markers', { position: 'top-right' });

    setMarkers(detectedMarkers);
  };

  const canSave = markers.length >= 4;

  return (
    <div className="w-full h-dvh flex flex-col gap-1 overflow-hidden">
      <PageHeader title="Markers in Camera" className="absolute" />

      <div className="flex-1 overflow-hidden">
        <PresentCanvas>
          <ArucoPointsScene markers={markers} />
        </PresentCanvas>
      </div>

      <div className="absolute bottom-4 right-4 flex items-center justify-end gap-2 p-2 bg-white/80 rounded-lg shadow-sm">
        {/* Action buttons for reset and save */}
        <DetectArucosButton onMarkersDetected={handleMarkersDetected} />
        <Button variant="secondary" onClick={handleReset}>
          Reset
        </Button>
        <Button onClick={handleSave} disabled={!canSave}>
          Save
        </Button>
      </div>
    </div>
  );
};
