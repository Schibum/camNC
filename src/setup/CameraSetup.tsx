
import { useState, useEffect } from "react"
import { UrlEntryStep } from "./UrlEntryStep"
import { PointSelectionStep } from "./PointSelectionStep"
import { useAtom } from "jotai"
import { cameraConfigAtom, type IBox } from "../atoms"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

export type Point = [number, number]

interface CameraSetupProps {
  onSave: () => void
}

const CameraSetup = ({ onSave }: CameraSetupProps) => {
  // Main state and tab tracking
  const [cameraConfig, setCameraConfig] = useAtom(cameraConfigAtom)
  const [url, setUrl] = useState(cameraConfig?.url || "")
  const [videoDimensions, setVideoDimensions] = useState<[number, number]>([0, 0])
  const [activeTab, setActiveTab] = useState<string>("url-entry")


  // Handlers for tab actions
  const handleUrlConfirm = (streamUrl: string) => {
    setUrl(streamUrl)
    setActiveTab("point-selection")
  }

  const handlePointsConfirm = (selectedPoints: IBox) => {
    setCameraConfig({
      url: url,
      machineBoundsInCam: selectedPoints,
      dimensions: videoDimensions,
      // TODO: ask for those too
      machineBounds: [
        [0, 0],
        [625, 1235],
      ],
    })

    if (onSave) {
      onSave()
    }
  }

  // Reset to URL tab
  const handleReset = () => {
    setActiveTab("url-entry")
  }

  const handleVideoLoad = (width: number, height: number) => {
    setVideoDimensions([width, height])
  }

  return (
    <div className="camera-setup-wizard" style={{ userSelect: "none" }}>
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="url-entry">Camera URL</TabsTrigger>
          <TabsTrigger value="point-selection" disabled={!url}>
            Machine Bounds
          </TabsTrigger>
        </TabsList>

        <TabsContent value="url-entry" className="mt-4">
          <UrlEntryStep initialUrl={url} onConfirm={handleUrlConfirm} />
        </TabsContent>

        <TabsContent value="point-selection" className="mt-4">
          {url && (
            <PointSelectionStep
              url={url}
              initialPoints={cameraConfig?.machineBoundsInCam || []}
              onSave={handlePointsConfirm}
              onReset={handleReset}
              onVideoLoad={handleVideoLoad}
            />
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}

export default CameraSetup

