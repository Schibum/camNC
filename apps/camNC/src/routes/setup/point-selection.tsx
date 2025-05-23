import { createFileRoute, redirect } from '@tanstack/react-router';
import { ThreePointSelectionStep } from '../../setup/ThreePointSelectionStep';
import { useStore } from '../../store/store';

export const Route = createFileRoute('/setup/point-selection')({
  component: ThreePointSelectionStep,
  loader: async () => {
    const machineBounds = useStore.getState().camSource?.machineBounds;
    if (!machineBounds) {
      throw redirect({ to: '/setup/machine-bounds' });
    }
  },
});
