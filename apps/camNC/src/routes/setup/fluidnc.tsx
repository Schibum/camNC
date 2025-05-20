import { FluidNcUrlCopyInput } from '@/visualize/toolbar/FluidNcUrlCopyInput';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { Button } from '@wbcnc/ui/components/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@wbcnc/ui/components/card';
import { PageHeader } from '@wbcnc/ui/components/page-header';

export const Route = createFileRoute('/setup/fluidnc')({
  component: RouteComponent,
});

function RouteComponent() {
  const navigate = useNavigate();
  return (
    <div className="w-full h-full">
      <PageHeader title="FluidNC" />
      <div className="flex justify-center p-1 flex-row">
        <Card className="w-full max-w-xl">
          <CardHeader>
            <CardTitle>FluidNC Integration</CardTitle>
            <CardDescription>
              In WebUI v3, add under Settings → Interface → Additional Content as Panel with type Extension.
              <p>This is optional, you can also just continue without setting up the FluidNC integration.</p>
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col gap-4">
              <FluidNcUrlCopyInput />
              <div className="flex flex-row gap-2 justify-end">
                <Button onClick={() => navigate({ to: '/setup/machine-bounds' })}>Continue</Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
