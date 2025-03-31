import { Line } from '@react-three/drei';
import { Object3D, Vector3 } from 'three';

interface LineAxesHelperProps extends Partial<Object3D> {
  size?: number;
  lineWidth?: number;
}

const DEFAULT_SIZE = 1;
const DEFAULT_LINE_WIDTH = 2;

export function LineAxesHelper({ size = DEFAULT_SIZE, lineWidth = DEFAULT_LINE_WIDTH, ...object3DProps }: LineAxesHelperProps) {
  const axisPoints = [
    // X axis (red)
    { start: new Vector3(0, 0, 0), end: new Vector3(size, 0, 0), color: '#ff0000' },
    // Y axis (green)
    { start: new Vector3(0, 0, 0), end: new Vector3(0, size, 0), color: '#00ff00' },
    // Z axis (blue)
    { start: new Vector3(0, 0, 0), end: new Vector3(0, 0, size), color: '#0000ff' },
  ];

  return (
    <group {...object3DProps}>
      {axisPoints.map((axis, index) => (
        <Line key={index} points={[axis.start, axis.end]} color={axis.color} lineWidth={lineWidth} />
      ))}
    </group>
  );
}
