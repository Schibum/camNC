import UnskewTsl from '@/calibration/UnskewTsl'
import VideoUndistorter from '@/calibration/VideoUndistorter'
import { createFileRoute } from '@tanstack/react-router'



export const Route = createFileRoute('/undistort2')({
  component: RouteComponent,
})

function RouteComponent() {
  return <div className="flex flex-col gap-4">
    <UnskewTsl />
  </div>
}
