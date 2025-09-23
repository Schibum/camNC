import { createFileRoute, Link } from '@tanstack/react-router';
import { Button } from '@wbcnc/ui/components/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@wbcnc/ui/components/card';
import { useLayoutEffect, useRef } from 'react';

const features = [
  {
    title: 'Verify clearance at a glance',
    description:
      'Overlay the programmed path on the live camera view so you can catch clamps, fixtures, and stock rotation issues before pressing start.',
    detail:
      'With the camera aligned to machine coordinates, you simply look at the overlay to confirm the cut will stay on the material you expect.',
  },
  {
    title: 'Jog and zero visually',
    description: 'Double-click to jog to any position or drag & drop the visualization to easily set zero.',
    detail:
      'With "snap-to-toolpath" enabled, you can double-click anywhere on the toolpath visualization to move the machine to that exact XY coordinate.',
  },
  {
    title: 'Fade the machine when it blocks the cut',
    description: 'Enable hide-machine mode to dim the machine when hardware is in the way, so you can still see the stock.',
    detail:
      'No need to manually move the machine out of the way in many cases - you can still see old pixels for areas currently occluded.',
  },
];

function CredentiallessIframe({ src, ...props }: React.IframeHTMLAttributes<HTMLIFrameElement>) {
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Ensure the attribute exists before src is applied
  useLayoutEffect(() => {
    const node = iframeRef.current;
    if (!node) return;
    node.setAttribute('credentialless', 'true');
    if (typeof src === 'string' && src.length > 0) {
      node.src = src;
    }
  }, [src]);

  // Do NOT pass src via props so React doesn't start loading before we set the attribute
  return <iframe ref={iframeRef} {...props} />;
}

export const Route = createFileRoute('/about/')({
  component: AboutPage,
  ssr: true,
});

function AboutPage() {
  return (
    <div className="relative">
      {/* GitHub Logo in top right corner */}
      <div className="absolute right-4 top-4 z-10 md:right-6 md:top-6">
        <a
          href="https://github.com/Schibum/camNC"
          target="_blank"
          rel="noopener noreferrer"
          className="block opacity-80 hover:opacity-100 transition-opacity duration-200"
          aria-label="View source code on GitHub">
          <svg className="h-8 w-8 fill-current text-foreground" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
            <path d="M12 0C5.374 0 0 5.373 0 12 0 17.302 3.438 21.8 8.207 23.387c.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.509 11.509 0 0112 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576C20.566 21.797 24 17.3 24 12c0-6.627-5.373-12-12-12z" />
          </svg>
        </a>
      </div>

      <main
        className="flex w-screen flex-col items-center gap-16 bg-gradient-to-b from-background via-background/95 to-muted/40 px-4 pb-20 pt-16 md:gap-20 md:px-6"
        aria-labelledby="about-heading">
        <section className="flex w-full max-w-5xl flex-col items-center gap-10 text-center">
          <div className="flex flex-col items-center gap-6">
            <div className="flex flex-col gap-4">
              <h1 id="about-heading" className="text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
                Toolpath visualization on top of a live camera feed
              </h1>
              <p className="text-lg text-muted-foreground">
                camNC overlays your programmed toolpath on the live camera feed. Open the app to double-check stock orientation, offsets,
                and clearance before the spindle ever turns on.
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-3">
              <Button asChild>
                <Link to="/setup/point-selection">Start camera setup</Link>
              </Button>
            </div>
          </div>
          <div className="mx-auto flex max-w-xl flex-col gap-4 text-base text-muted-foreground">
            <p>
              Position an overhead camera, walk through the calibration steps, and the overlay locks to the machine coordinates. From then
              on you can glance at the screen to see whether the cut will land where you expect or bump into clamps.
            </p>
          </div>
        </section>

        <section className="w-full max-w-5xl space-y-6" aria-labelledby="features-heading">
          <div className="mx-auto flex max-w-3xl flex-col items-center gap-4 text-center">
            <h2 id="features-heading" className="text-2xl font-semibold tracking-tight">
              Key capabilities
            </h2>
            <p className="text-muted-foreground">
              The application focuses on aligning virtual toolpaths with the physical machine and keeping remote control tools close to the
              live view.
            </p>
          </div>
          <div className="grid gap-6 md:grid-cols-2">
            {features.map(feature => (
              <Card key={feature.title} className="h-full border border-border/60 bg-card/60 shadow-lg shadow-black/5">
                <CardHeader>
                  <CardTitle>{feature.title}</CardTitle>
                  <CardDescription>{feature.description}</CardDescription>
                </CardHeader>
                <CardContent className="text-sm text-muted-foreground">{feature.detail}</CardContent>
              </Card>
            ))}
          </div>
        </section>

        <section className="w-full max-w-5xl space-y-6" aria-labelledby="demo-heading">
          <div className="mx-auto flex max-w-3xl flex-col items-center gap-4 text-center">
            <h2 id="demo-heading" className="text-2xl font-semibold tracking-tight">
              Demonstration cut
            </h2>
            <p className="text-muted-foreground">
              This recording shows cutting a small oak board with the hide-machine feature enabled. The view of occluded parts updates
              dynamically as the machine moves, revealing the cut progress beneath.
            </p>
          </div>
          <figure className="flex flex-col gap-4" aria-label="Video demonstration of camNC cutting a small board">
            <div className="relative aspect-video w-full overflow-hidden rounded-2xl border border-border bg-gradient-to-b from-muted to-background shadow-2xl">
              <CredentiallessIframe
                src="https://www.youtube.com/embed/KKgJ9J6dmqE?d"
                title="camNC demo: cutting oak with perspective overlays"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                allowFullScreen
                className="absolute inset-0 h-full w-full"
              />
            </div>
            <figcaption className="text-sm text-muted-foreground">
              Cutting a small board while the overlay highlights the programmed path and the stock stays visible behind the machine.
            </figcaption>
          </figure>
        </section>

        <section className="w-full max-w-5xl space-y-6" aria-labelledby="setup-heading">
          <div className="mx-auto flex max-w-3xl flex-col items-center gap-4 text-center">
            <h2 id="setup-heading" className="text-2xl font-semibold tracking-tight">
              Typical setup
            </h2>
            <p className="text-muted-foreground">
              The basics are a calibrated camera, printed markers, and optionally a FluidNC controller.
            </p>
          </div>
          <ul className="list-inside space-y-3 text-left text-base text-muted-foreground">
            <li>
              <strong>Camera:</strong> An old overhead phone, webcam, or IP camera (connected through go2rtc) provides the video stream.
            </li>
            <li>
              <strong>Markers:</strong> A printed ArUco markers allow camNC continuous pose estimation, even if the camera or table moves.
            </li>
            <li>
              <strong>Optional:</strong> A FluidNC WebUI v3 integration used for click-to-jog and sending programs directly.
            </li>
          </ul>
        </section>

        {/* Footer note */}
        <footer className="w-full max-w-5xl pt-8 text-center">
          <p className="text-xs text-muted-foreground/70">
            Free and open-source —{' '}
            <a
              href="https://github.com/Schibum/camNC"
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-4 hover:text-muted-foreground">
              GitHub
            </a>
          </p>
        </footer>
      </main>
    </div>
  );
}
