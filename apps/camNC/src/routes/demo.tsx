import { createFileRoute, redirect } from '@tanstack/react-router';
import { PageHeader } from '@/components/page-header';
import { SampleProjectCard } from '@/cam/samples/SampleProjectCard';
import { isDemoMode, isLocalPreviewDemo } from '@/lib/demo/demo-mode';
import { isDemoChoiceUrl } from '@/lib/demo/demo-context';
import { Button } from '@wbcnc/ui/components/button';

/** The demo's entry point. Demo mode itself is switched on in lib/demo/demo-mode.ts, before the app starts. */
export const Route = createFileRoute('/demo')({
  beforeLoad: ({ location }) => {
    const localChoice = isLocalPreviewDemo() && isDemoChoiceUrl(new URL(location.href, globalThis.location.origin));
    if (isDemoMode() && !localChoice) throw redirect({ to: '/visualize/2DView', search: { view: 'top' }, replace: true });
  },
  component: DemoEntry,
});

function DemoEntry() {
  return (
    <div className="w-full">
      <PageHeader title="Explore camNC" />
      <div className="mx-auto flex max-w-2xl flex-col gap-6 p-6">
        <div>
          <h1 className="text-2xl font-medium">Try camNC without a machine</h1>
          <p className="mt-2 text-muted-foreground">Start with a saved CAM project, or explore a simulated controller.</p>
        </div>
        <SampleProjectCard />
        <section className="flex flex-col items-start gap-3 rounded-lg border p-5">
          <h2 className="text-lg font-medium">Explore a demo machine</h2>
          <p className="text-sm text-muted-foreground">
            Jog, home, probe and run G-code with a simulated FluidNC. The camera is a recorded example, not a live feed. Demo changes are
            discarded.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline">
              <a href="/demo?machine=1">Explore demo machine</a>
            </Button>
            <Button asChild variant="ghost">
              <a href="/demo?camera=off">Without a camera</a>
            </Button>
          </div>
        </section>
      </div>
    </div>
  );
}
