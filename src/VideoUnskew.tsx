import React, { useState } from 'react';
import CameraSetup, { CameraSetupResult, Point } from './setup/CameraSetup';
import { UnskewThree } from './UnskewThree';

interface VideoUnskewProps {
  initialUrl?: string;
  initialPoints?: Point[];
}

export const VideoUnskew: React.FC<VideoUnskewProps> = ({ initialUrl, initialPoints }) => {
  const [showSetup, setShowSetup] = useState(true);
  const [config, setConfig] = useState<CameraSetupResult | null>(null);

  const handleSetupSave = (result: CameraSetupResult) => {
    console.log('handleSetupSave', result);
    setConfig(result);
    setShowSetup(false);
  };

  const handleSettingsClick = () => {
    setShowSetup(true);
  };

  if (showSetup) {
    return <CameraSetup initialUrl={initialUrl} initialPoints={initialPoints} onSave={handleSetupSave} />;
  }

  if (!config) return null;

  // Convert points from CameraSetup format to UnskewThree format

  return (
    <div style={{ position: 'relative' }}>
      <UnskewThree
        videoUrl={config.url}
        srcPoints={config.points}
        imageSize={config.dimensions}
      />
      <button
        onClick={handleSettingsClick}
        style={{
          position: 'absolute',
          top: '10px',
          right: '10px',
          padding: '8px',
          background: 'rgba(255, 255, 255, 0.8)',
          border: '1px solid #ccc',
          borderRadius: '4px',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: '4px'
        }}
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="currentColor"
        >
          <path d="M8 5a3 3 0 100 6 3 3 0 000-6zM6.5 8a1.5 1.5 0 113 0 1.5 1.5 0 01-3 0z"/>
          <path fillRule="evenodd" d="M11.493 3.014c-.236-.008-.487-.014-.743-.014-.256 0-.507.006-.743.014a1.5 1.5 0 01-1.364-.98l-.17-.42A1.5 1.5 0 007.123 0h-1.75a1.5 1.5 0 00-1.35.914l-.17.42a1.5 1.5 0 01-1.364.98 11.538 11.538 0 00-.743.014A1.5 1.5 0 000 4.5v1.75c0 .698.483 1.3 1.162 1.45.236.008.487.014.743.014.256 0 .507-.006.743-.014a1.5 1.5 0 011.364.98l.17.42a1.5 1.5 0 001.35.914h1.75a1.5 1.5 0 001.35-.914l.17-.42a1.5 1.5 0 011.364-.98c.236-.008.487-.014.743-.014.256 0 .507.006.743.014A1.5 1.5 0 0013 6.25V4.5a1.5 1.5 0 00-1.507-1.486zM8 4a4 4 0 100 8 4 4 0 000-8z"/>
        </svg>
        Settings
      </button>
    </div>
  );
};