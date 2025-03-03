import React, { useState } from 'react';
import { UrlEntryStep } from './UrlEntryStep';
import { PointSelectionStep } from './PointSelectionStep';
import { useAtom, useAtomValue } from 'jotai';
import { cameraConfigAtom, IBox } from '../atoms';

export type Point = [number, number];


interface CameraSetupProps {
  onSave: () => void;
}

enum SetupStep {
  URL_ENTRY,
  POINT_SELECTION
}

const CameraSetup = ({ onSave }: CameraSetupProps) => {
  // Main state and step tracking
  const [cameraConfig, setCameraConfig] = useAtom(cameraConfigAtom);
  const [url, setUrl] = useState(cameraConfig?.url || '');
  // const [points, setPoints] = useState<Point[]>(useAtomValue(machineBoundsInCam) || []);
  const [videoDimensions, setVideoDimensions] = useState<[number, number]>([0, 0]);
  const [currentStep, setCurrentStep] = useState(url ? SetupStep.POINT_SELECTION : SetupStep.URL_ENTRY);

  // Handlers for step transitions
  const handleUrlConfirm = (streamUrl: string) => {
    setUrl(streamUrl);
    setCurrentStep(SetupStep.POINT_SELECTION);
  };

  const handlePointsConfirm = (selectedPoints: IBox) => {
    setCameraConfig({
      url: url,
      machineBoundsInCam: selectedPoints,
      dimensions: videoDimensions,
      // TODO: ask for those too
      machineBounds: [
        [0, 0], [625, 1235]
      ]
    });

    if (onSave) {
      onSave()
    }
  };

  // Reset to URL step
  const handleReset = () => {
    setCurrentStep(SetupStep.URL_ENTRY);
  };

  const handleVideoLoad = (width: number, height: number) => {
    setVideoDimensions([width, height]);
  };

  // Show different steps based on current state
  return (
    <div className="camera-setup-wizard" style={{ userSelect: 'none' }}>
      {currentStep === SetupStep.URL_ENTRY && (
        <UrlEntryStep
          initialUrl={url}
          onConfirm={handleUrlConfirm}
        />
      )}

      {currentStep === SetupStep.POINT_SELECTION && (
        <PointSelectionStep
          url={url}
          initialPoints={cameraConfig?.machineBoundsInCam || []}
          onSave={handlePointsConfirm}
          onReset={handleReset}
          onVideoLoad={handleVideoLoad}
        />
      )}
    </div>
  );
};

export default CameraSetup;
