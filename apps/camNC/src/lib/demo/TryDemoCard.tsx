import { useStore } from '@/store/store';
import { Button } from '@wbcnc/ui/components/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@wbcnc/ui/components/card';
import { FlaskConical } from 'lucide-react';
import { isDemoMode } from './demo-mode';

/** For visitors who have no camera set up yet: try camNC first, set up later. */
export function TryDemoCard() {
  const hasCamera = useStore(s => Object.keys(s.camSources).length > 0);
  if (isDemoMode() || hasCamera) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>New here? Try the demo</CardTitle>
        <CardDescription>
          See camNC on a real machine camera with a simulated controller, in one click and without any setup. Bring your own G-code if you
          like.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {/* A full page load, so that demo mode is decided before the app starts. */}
        <div className="flex flex-row flex-wrap items-center gap-2">
          <Button asChild>
            <a href="/demo">
              <FlaskConical /> Open the demo
            </a>
          </Button>
          <Button asChild variant="ghost">
            <a href="/demo?camera=off">Without a camera</a>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
