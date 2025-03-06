import * as React from 'react'
import { useState, useEffect } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useAtom } from 'jotai'
import { cameraConfigAtom, type IBox } from '../../atoms'
import { PointSelectionStep } from '../../setup/PointSelectionStep'

export const Route = createFileRoute('/setup/point-selection')({
  component: PointSelectionComponent,
})

function PointSelectionComponent() {
  const navigate = useNavigate()
  const [cameraConfig, setCameraConfig] = useAtom(cameraConfigAtom)
  const [url, setUrl] = useState(cameraConfig?.url || '')
  const [videoDimensions, setVideoDimensions] = useState<[number, number]>([0, 0])

  // Redirect to url-entry if no URL set
  useEffect(() => {
    if (!cameraConfig?.url) {
      navigate({ to: '/setup/url-entry' as any })
    } else {
      setUrl(cameraConfig.url)
    }
  }, [cameraConfig, navigate])

  const handlePointsConfirm = (selectedPoints: IBox) => {
    setCameraConfig({
      url: url,
      machineBoundsInCam: selectedPoints,
      dimensions: videoDimensions,
      machineBounds: [
        [0, 0],
        [625, 1235],
      ],
    })

    // Navigate to visualize route
    navigate({ to: '/visualize' })
  }

  const handleReset = () => {
    navigate({ to: '/setup/url-entry' as any })
  }

  const handleVideoLoad = (width: number, height: number) => {
    setVideoDimensions([width, height])
  }

  return (
    <div className="mt-4">
      {url && (
        <PointSelectionStep
          url={url}
          initialPoints={cameraConfig?.machineBoundsInCam || []}
          onSave={handlePointsConfirm}
          onReset={handleReset}
          onVideoLoad={handleVideoLoad}
        />
      )}
    </div>
  )
}