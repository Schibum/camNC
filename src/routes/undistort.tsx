import VideoUndistorter from '@/calibration/VideoUndistorter'
import { createFileRoute } from '@tanstack/react-router'



export const Route = createFileRoute('/undistort')({
  component: RouteComponent,
})

function RouteComponent() {
  return <div className="flex flex-col gap-4">
    <VideoUndistorter />

  </div>
}
