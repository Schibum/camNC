import React, { useState } from 'react';
import { UrlEntryStep } from './components/UrlEntryStep';
import { PointSelectionStep } from './components/PointSelectionStep';

export type Point = [number, number];

export interface CameraSetupResult {
  url: string;
  points: Point[];
  dimensions: [number, number];  // [width, height]
}

interface CameraSetupProps {
  initialUrl?: string;
  initialPoints?: Point[];
  onSave: (data: CameraSetupResult) => void;
}

enum SetupStep {
  URL_ENTRY,
  POINT_SELECTION
}

const CameraSetup = ({ initialUrl = '', initialPoints = [], onSave }: CameraSetupProps) => {
  // Main state and step tracking
  const [url, setUrl] = useState(initialUrl);
  const [points, setPoints] = useState<Point[]>(initialPoints);
  const [videoDimensions, setVideoDimensions] = useState<[number, number]>([0, 0]);
  const [currentStep, setCurrentStep] = useState(initialUrl ? SetupStep.POINT_SELECTION : SetupStep.URL_ENTRY);

  // Handlers for step transitions
  const handleUrlConfirm = (streamUrl: string) => {
    setUrl(streamUrl);
    setCurrentStep(SetupStep.POINT_SELECTION);
  };

  const handlePointsConfirm = (selectedPoints: Point[]) => {
    if (onSave) {
      onSave({
        url,
        points: selectedPoints,
        dimensions: videoDimensions
      });
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
    <div className="camera-setup-wizard" style={{userSelect: 'none'}}>
      {currentStep === SetupStep.URL_ENTRY && (
        <UrlEntryStep
          initialUrl={url}
          onConfirm={handleUrlConfirm}
        />
      )}

      {currentStep === SetupStep.POINT_SELECTION && (
        <PointSelectionStep
          url={url}
          initialPoints={points}
          onSave={handlePointsConfirm}
          onReset={handleReset}
          onVideoLoad={handleVideoLoad}
        />
      )}
    </div>
  );
};

export default CameraSetup;
