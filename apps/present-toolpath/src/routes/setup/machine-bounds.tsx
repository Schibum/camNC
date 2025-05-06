import { useStore } from '@/store';
import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router';
import { Card, CardContent, CardHeader, CardTitle } from '@wbcnc/ui/components/card';
import { PageHeader } from '@wbcnc/ui/components/page-header';
import { MachineBoundsForm } from '../../setup/MachineBoundsDialog';

export const Route = createFileRoute('/setup/machine-bounds')({
  component: RouteComponent,
  loader: async () => {
    const calibration = useStore.getState().camSource?.calibration;
    if (!calibration) {
      throw redirect({ to: '/setup/camera-calibration' });
    }
  },
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
                navigate({ to: '/setup/point-selection' });
              }}
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
