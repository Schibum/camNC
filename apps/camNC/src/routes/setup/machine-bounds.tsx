import { PageHeader } from '@/components/page-header';
import { isCameraReady, useStore } from '@/store/store';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { Card, CardContent, CardHeader, CardTitle } from '@wbcnc/ui/components/card';
import { MachineBoundsForm } from '../../setup/MachineBoundsForm';

export const Route = createFileRoute('/setup/machine-bounds')({
  // The bounds belong to the machine, so they can be set up without a camera.
  component: RouteComponent,
});

function RouteComponent() {
  const navigate = useNavigate();
  // A camera that is being set up continues with its markers, otherwise the bed is ready to use.
  const cameraInSetup = useStore(s => {
    const cam = s.activeCamId ? s.camSources[s.activeCamId] : null;
    return !!cam?.calibration && !isCameraReady(cam);
  });
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
                navigate({ to: cameraInSetup ? '/setup/marker-positions' : '/visualize/2DView' });
              }}
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
