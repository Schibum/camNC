import { getMachinePlaneLayout } from '@/calibration/machinePlane';
import { useMachineBounds } from '@/store/store';
import { type ThreeElements } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { gridLines, kBedColors } from './machineBedGrid';

/** Line segments (pairs of points) of a grid over `bounds`, every `step` mm, skipping lines that are also on `skipEvery`. */
function gridGeometry(bounds: THREE.Box2, step: number, skipEvery?: number) {
  const points: number[] = [];
  const keep = (v: number) => !skipEvery || Math.abs(v / skipEvery - Math.round(v / skipEvery)) > 1e-6;
  for (const x of gridLines(bounds.min.x, bounds.max.x, step).filter(keep)) points.push(x, bounds.min.y, 0, x, bounds.max.y, 0);
  for (const y of gridLines(bounds.min.y, bounds.max.y, step).filter(keep)) points.push(bounds.min.x, y, 0, bounds.max.x, y, 0);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
  return geometry;
}

const noRaycast = () => null;

/**
 * Stands in for the camera image in the top view while no camera is set up: the machine bed with a 10 mm and 100 mm
 * grid in machine coordinates. Pointer handlers go to a plane slightly larger than the bed, like on the video, so that
 * clicks just outside the bed still report a position. Drawn first and without depth, so the toolpath always shows on top.
 */
export function MachineBedMesh({ overSize = 50, ...props }: { overSize?: number } & ThreeElements['mesh']) {
  const bounds = useMachineBounds();

  const { hitPlane, bed, minor, major } = useMemo(() => {
    const hit = getMachinePlaneLayout(bounds, overSize);
    const hitPlane = new THREE.PlaneGeometry(hit.width, hit.height).translate(hit.center.x, hit.center.y, 0);
    const layout = getMachinePlaneLayout(bounds);
    const bed = new THREE.PlaneGeometry(layout.width, layout.height).translate(layout.center.x, layout.center.y, 0);
    return { hitPlane, bed, minor: gridGeometry(bounds, 10, 100), major: gridGeometry(bounds, 100) };
  }, [bounds, overSize]);
  useEffect(() => () => [hitPlane, bed, minor, major].forEach(g => g.dispose()), [hitPlane, bed, minor, major]);

  return (
    <group>
      <mesh geometry={hitPlane} {...props}>
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      <mesh geometry={bed} raycast={noRaycast} renderOrder={-3}>
        <meshBasicMaterial color={kBedColors.fill} depthWrite={false} />
      </mesh>
      <lineSegments geometry={minor} raycast={noRaycast} renderOrder={-2}>
        <lineBasicMaterial color={kBedColors.minor} depthWrite={false} />
      </lineSegments>
      <lineSegments geometry={major} raycast={noRaycast} renderOrder={-1}>
        <lineBasicMaterial color={kBedColors.major} depthWrite={false} />
      </lineSegments>
    </group>
  );
}
