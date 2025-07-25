import { EnsureHasCamSource } from '@/components/EnsureHasCamSource';
import { PageHeader } from '@/components/page-header';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { Card, CardContent, CardHeader, CardTitle } from '@wbcnc/ui/components/card';
import { MarkerPositionsForm } from '../../setup/MarkerPositionsForm';

export const Route = createFileRoute('/setup/marker-positions')({
  component: () => (
    <EnsureHasCamSource to="/setup/machine-bounds" predicate={s => !!s.machineBounds}>
      <RouteComponent />
    </EnsureHasCamSource>
  ),
});

function RouteComponent() {
  const navigate = useNavigate();
  return (
    <div className="w-full h-full">
      <PageHeader title="Marker Positions" />
      <div className="flex justify-center p-1 flex-row">
        <Card className="w-full max-w-xl">
          <CardHeader>
            <CardTitle>Marker Positions</CardTitle>
          </CardHeader>
          <CardContent>
            <MarkerPositionsForm onConfirmed={() => navigate({ to: '/setup/point-selection' })} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
