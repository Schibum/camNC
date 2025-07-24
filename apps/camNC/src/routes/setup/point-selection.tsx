import { createFileRoute, redirect } from '@tanstack/react-router';
import { ThreePointSelectionStep } from '../../setup/ThreePointSelectionStep';
import { useStore, getActiveCamSource } from '../../store/store';

export const Route = createFileRoute('/setup/point-selection')({
  component: ThreePointSelectionStep,
  loader: async () => {
    const machineBounds = getActiveCamSource()?.markerPositions;
    if (!machineBounds) {
      throw redirect({ to: '/setup/marker-positions' });
    }
  },
});
