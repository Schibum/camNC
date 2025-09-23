import { EnsureHasCamSource } from '@/components/EnsureHasCamSource';
import { createFileRoute, Navigate } from '@tanstack/react-router';

export const Route = createFileRoute('/')({
  component: HomeComponent,
});

function HomeComponent() {
  return (
    <EnsureHasCamSource to="/about" predicate={source => !!source.extrinsics}>
      <Navigate to="/visualize/2DView" replace />
    </EnsureHasCamSource>
  );
}
