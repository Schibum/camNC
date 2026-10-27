import { MachineConnectionForm } from '@/components/machine/MachineConnectionForm';
import { PageHeader } from '@/components/page-header';
import { TryDemoCard } from '@/lib/demo/TryDemoCard';
import { MachineBoundsForm } from '@/setup/MachineBoundsForm';
import { BedFromMachine } from '@/start/BedFromMachine';
import { boundsFromSize, kBedPresets } from '@/start/bedPresets';
import { useStore } from '@/store/store';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { Button } from '@wbcnc/ui/components/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@wbcnc/ui/components/card';
import { toast } from '@wbcnc/ui/components/sonner';
import { Camera } from 'lucide-react';
import { useState } from 'react';

export const Route = createFileRoute('/start')({
  component: StartComponent,
});

/** Getting started without a camera: connect FluidNC (or pick a bed size), and the top view works on a drawn bed. */
function StartComponent() {
  const navigate = useNavigate();
  const setMachineBounds = useStore(s => s.setMachineBounds);
  const [customSize, setCustomSize] = useState(false);

  function openWorkspace() {
    navigate({ to: '/visualize/2DView' });
    toast.info('Open a G-code file with O or drop one on the page. With a machine connected, double-click the bed to jog there.', {
      duration: 10_000,
    });
  }

  return (
    <div className="w-full h-full">
      <PageHeader title="Get started" />
      <div className="flex justify-center p-1 flex-row">
        <div className="max-w-xl gap-4 flex flex-1 flex-col pb-8">
          <p className="text-sm text-muted-foreground px-1">
            See your G-code on your machine, jog and run jobs. No camera needed to start: camNC draws your bed, and you can add a camera any
            time later.
          </p>
          <Card>
            <CardHeader>
              <CardTitle>Connect your FluidNC</CardTitle>
              <CardDescription>camNC reads the bed size from the controller over your local network.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <MachineConnectionForm />
              <BedFromMachine onConfirmed={openWorkspace} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>No machine at hand? Preview G-code</CardTitle>
              <CardDescription>
                Pick a bed size to see your toolpaths, their depths and the 3D view. You can connect a machine later.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div className="flex flex-row flex-wrap gap-2">
                {kBedPresets.map(preset => (
                  <Button
                    key={preset.label}
                    variant="outline"
                    onClick={() => {
                      const b = boundsFromSize(preset.width, preset.depth);
                      setMachineBounds(b.xmin, b.ymin, b.xmax, b.ymax);
                      openWorkspace();
                    }}>
                    {preset.label}{' '}
                    <span className="text-muted-foreground">
                      {preset.width} × {preset.depth}
                    </span>
                  </Button>
                ))}
                <Button variant="ghost" onClick={() => setCustomSize(v => !v)}>
                  Custom size…
                </Button>
              </div>
              {customSize && <MachineBoundsForm submitLabel="Open workspace" onConfirmed={openWorkspace} />}
            </CardContent>
          </Card>
          <TryDemoCard />
          <p className="text-sm text-muted-foreground px-1 flex flex-row items-center gap-2">
            <Camera className="size-4" /> Have a camera above your machine?{' '}
            <Link to="/setup/url-entry" className="underline">
              Set it up now
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
