import { UnprojectTsl } from '@/calibration/Unproject';
import { createFileRoute } from '@tanstack/react-router';
import { Button } from '@wbcnc/ui/components/button';
import { PageHeader } from '@wbcnc/ui/components/page-header';

export const Route = createFileRoute('/unproject')({
  component: RouteComponent,
});

function RouteComponent() {
  return (
    <div className="relative w-full h-full">
      <PageHeader title="Unproject" className="absolute" />
      <Button className="absolute top-4 right-4 z-10">Start</Button>

      {/* 3D Canvas */}
      <div className="w-full h-dvh absolute top-0 left-0">
        <UnprojectTsl />
      </div>
    </div>
  );
}
