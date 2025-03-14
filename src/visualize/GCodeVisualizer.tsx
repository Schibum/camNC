import { useMachineSize } from '@/store';
import React from 'react';
import { Toolpaths } from './Toolpaths';

interface GCodeVisualizerProps {}

export const GCodeVisualizer: React.FC<GCodeVisualizerProps> = () => {
  const machineSize = useMachineSize();
  const offsetX = machineSize[0] / 2;
  const offsetY = machineSize[1] / 2;

  return (
    <group position={[-offsetX, -offsetY, 0.1]}>
      <Toolpaths />
    </group>
  );
};
