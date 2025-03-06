import * as React from 'react'
import { useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useAtom } from 'jotai'
import { cameraConfigAtom } from '../atoms'
import { UrlEntryStep } from '../setup/UrlEntryStep'

export const Route = createFileRoute('/setup/url-entry')({
  component: UrlEntryComponent,
})

function UrlEntryComponent() {
  const navigate = useNavigate()
  const [cameraConfig] = useAtom(cameraConfigAtom)
  const [url, setUrl] = useState(cameraConfig?.url || '')

  const handleUrlConfirm = (streamUrl: string) => {
    setUrl(streamUrl)
    navigate({ to: '/setup/point-selection' as any })
  }

  return (
    <div className="mt-4">
      <UrlEntryStep initialUrl={url} onConfirm={handleUrlConfirm} />
    </div>
  )
}