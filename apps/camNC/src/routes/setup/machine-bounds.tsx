import { EnsureHasCamSource } from '@/components/EnsureHasCamSource';
import { PageHeader } from '@/components/page-header';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { Card, CardContent, CardHeader, CardTitle } from '@wbcnc/ui/components/card';
import { MachineBoundsForm } from '../../setup/MachineBoundsForm';

export const Route = createFileRoute('/setup/machine-bounds')({
  component: () => (
    <EnsureHasCamSource to="/setup/camera-calibration" predicate={s => !!s.calibration}>
      <RouteComponent />
    </EnsureHasCamSource>
  ),
});

function RouteComponent() {
  const navigate = useNavigate();
  return (
    <div className="w-full h-full">
      <PageHeader title="Machine Bounds" />
      <div className="flex justify-center p-1 flex-row">
        <Card className="w-full max-w-xl">
          <CardHeader>
            <CardTitle>Machine Bounds</CardTitle>
          </CardHeader>
          <CardContent>
            <MachineBoundsForm
              onConfirmed={() => {
                navigate({ to: '/setup/marker-positions' });
              }}
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
