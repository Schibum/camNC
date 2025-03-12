import { createFileRoute } from '@tanstack/react-router';
import { ThreePointSelectionStep } from '../../setup/ThreePointSelectionStep';

export const Route = createFileRoute('/setup/point-selection')({
  component: ThreePointSelectionStep,
});
