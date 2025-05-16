import UnskewTsl from '@/calibration/UnskewTsl';
import { createFileRoute } from '@tanstack/react-router';
import { PageHeader } from '@wbcnc/ui/components/page-header';

export const Route = createFileRoute('/debug/undistort2')({
  component: RouteComponent,
});

function RouteComponent() {
  return (
    <div className="relative w-full h-full">
      <PageHeader title="Unskew" className="absolute" />

      {/* 3D Canvas */}
      <div className="w-full h-dvh absolute top-0 left-0">
        <UnskewTsl />
      </div>
    </div>
  );
}
