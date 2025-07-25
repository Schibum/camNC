import { EnsureHasCamSource } from '@/components/EnsureHasCamSource';
import { createFileRoute } from '@tanstack/react-router';
import { ThreePointSelectionStep } from '../../setup/ThreePointSelectionStep';

export const Route = createFileRoute('/setup/point-selection')({
  component: () => (
    <EnsureHasCamSource to="/setup/marker-positions" predicate={s => !!s.markerPositions}>
      <ThreePointSelectionStep />
    </EnsureHasCamSource>
  ),
});
