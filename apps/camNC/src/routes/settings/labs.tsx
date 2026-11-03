import { PageHeader } from '@/components/page-header';
import { useLabs } from '@/cam/labs';
import { createFileRoute, Link } from '@tanstack/react-router';
import { Checkbox } from '@wbcnc/ui/components/checkbox';
import { Label } from '@wbcnc/ui/components/label';

export const Route = createFileRoute('/settings/labs')({
  component: Labs,
});

/** Opt-in features that are still being built. */
function Labs() {
  const { camBeta, setCamBeta } = useLabs();
  return (
    <div className="flex h-dvh w-full min-w-0 flex-col">
      <PageHeader title="Labs" />
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-6">
        <p className="text-sm text-muted-foreground">Features that are still being built. They may change or go away.</p>
        <div className="flex gap-3">
          <Checkbox id="cam-beta" checked={camBeta} onCheckedChange={v => setCamBeta(v === true)} className="mt-0.5" />
          <div className="flex flex-col gap-1">
            <Label htmlFor="cam-beta">CAM (beta)</Label>
            <p className="text-sm text-muted-foreground">
              Make G-code from STEP or STL models of flat parts: boards are found and laid flat, pockets, holes and outlines are cut. Adds{' '}
              <Link to="/cam" className="underline">
                CAM (beta)
              </Link>{' '}
              to the menu, and dropping a model file starts a job.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
