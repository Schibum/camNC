import { MachineConnectionForm } from '@/components/machine/MachineConnectionForm';
import { PageHeader } from '@/components/page-header';
import { ICamSource, isCameraReady, useCamSource, useMachineBoundsOrNull } from '@/store/store';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { Button } from '@wbcnc/ui/components/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@wbcnc/ui/components/card';

export const Route = createFileRoute('/setup/fluidnc')({
  component: RouteComponent,
});

/**
 * The next setup step after connecting: the machine bounds when unknown, the rest of a camera setup in progress
 * (marker positions → camera pose), or straight to the top view, which works without a camera.
 */
function nextStep(camSource: ICamSource | null, hasBounds: boolean) {
  if (!hasBounds) return '/setup/machine-bounds' as const;
  if (camSource?.calibration && !isCameraReady(camSource)) return '/setup/marker-positions' as const;
  return '/visualize/2DView' as const;
}

function RouteComponent() {
  const navigate = useNavigate();
  const next = nextStep(useCamSource(), !!useMachineBoundsOrNull());
  return (
    <div className="w-full h-full">
      <PageHeader title="Machine" />
      <div className="flex justify-center p-1 flex-row">
        <Card className="w-full max-w-xl">
          <CardHeader>
            <CardTitle>Connect to FluidNC</CardTitle>
            <CardDescription>
              camNC talks to your FluidNC controller (3.9.9 or 4.1.x) directly over your local network, for jogging, zeroing and running
              jobs. This is optional, you can also continue without a machine connection.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col gap-4">
              <MachineConnectionForm />
              <div className="flex flex-row gap-2 justify-end">
                {/* Connecting a machine should not walk through steps that are already done. */}
                <Button onClick={() => navigate({ to: next })}>{next === '/visualize/2DView' ? 'Continue to top view' : 'Continue'}</Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
