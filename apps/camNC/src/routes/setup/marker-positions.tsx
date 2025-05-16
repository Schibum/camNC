import { useStore } from '@/store';
import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router';
import { Card, CardContent, CardHeader, CardTitle } from '@wbcnc/ui/components/card';
import { PageHeader } from '@wbcnc/ui/components/page-header';
import { MarkerPositionsForm } from '../../setup/MarkerPositionsForm';

export const Route = createFileRoute('/setup/marker-positions')({
  component: RouteComponent,
  loader: async () => {
    const state = useStore.getState();
    const bounds = state.camSource?.machineBounds;
    if (!bounds) {
      throw redirect({ to: '/setup/machine-bounds' });
    }
  },
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
