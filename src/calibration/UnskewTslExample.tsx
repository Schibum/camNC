import React, { useState } from 'react';
import UnskewTsl from './UnskewTsl';
import { CalibrationData } from './undistort';
import { atom, useAtom, Provider } from 'jotai';

// Create mock atoms for the example
const mockCalibrationData: CalibrationData = {
  calibration_matrix: [
    [1200, 0, 960],
    [0, 1200, 540],
    [0, 0, 1],
  ],
  distortion_coefficients: [[-0.2, 0.1, 0, 0, 0]],
};

// Default to a publicly accessible video for testing
// Using a known-good test video with no CORS issues
const mockVideoSrc =
  'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4';

// Mock atoms for testing the component independently
const mockCalibrationDataAtom = atom(mockCalibrationData);
const mockVideoSrcAtom = atom(mockVideoSrc);

// Debug panel to show component state
const DebugPanel: React.FC<{
  videoSrc: string;
  setVideoSrc: (src: string) => void;
  calibrationData: CalibrationData;
  setCalibrationData: (data: CalibrationData) => void;
}> = ({ videoSrc, setVideoSrc, calibrationData, setCalibrationData }) => {
  const [showDebug, setShowDebug] = useState(false);

  const videoOptions = [
    {
      label: 'Big Buck Bunny',
      url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4',
    },
    {
      label: 'Elephants Dream',
      url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4',
    },
    {
      label: 'Sintel',
      url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/Sintel.mp4',
    },
  ];

  return (
    <div className="mb-6 border rounded shadow p-4 bg-gray-50">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-lg font-bold">Configuration</h2>
        <button
          onClick={() => setShowDebug(!showDebug)}
          className="px-3 py-1 bg-blue-100 rounded hover:bg-blue-200"
        >
          {showDebug ? 'Hide Debug' : 'Show Debug'}
        </button>
      </div>

      <div className="mb-4">
        <label className="block mb-2 font-medium">Video Source:</label>
        <div className="flex gap-2 mb-2">
          <input
            type="text"
            value={videoSrc}
            onChange={e => setVideoSrc(e.target.value)}
            className="flex-1 p-2 border rounded"
          />
        </div>

        <div className="grid grid-cols-3 gap-2 mb-2">
          {videoOptions.map(option => (
            <button
              key={option.url}
              onClick={() => setVideoSrc(option.url)}
              className={`p-2 rounded ${videoSrc === option.url ? 'bg-blue-200' : 'bg-gray-200 hover:bg-gray-300'}`}
            >
              {option.label}
            </button>
          ))}
        </div>

        <div className="mt-2 text-sm text-gray-500">
          Enter a URL to a video file (must be CORS-enabled)
        </div>
      </div>

      {showDebug && (
        <div className="mb-4">
          <label className="block mb-2 font-medium">Distortion Parameters:</label>
          <textarea
            value={JSON.stringify(calibrationData, null, 2)}
            onChange={e => {
              try {
                setCalibrationData(JSON.parse(e.target.value));
              } catch (err) {
                console.error('Invalid JSON:', err);
              }
            }}
            className="w-full p-2 border rounded font-mono text-sm h-40"
          />
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 mt-4">
        <button
          onClick={() =>
            setCalibrationData({
              ...calibrationData,
              distortion_coefficients: [
                calibrationData.distortion_coefficients[0].map(v => v * 1.2),
              ],
            })
          }
          className="p-2 bg-yellow-100 rounded hover:bg-yellow-200"
        >
          Increase Distortion
        </button>

        <button
          onClick={() =>
            setCalibrationData({
              ...calibrationData,
              distortion_coefficients: [
                calibrationData.distortion_coefficients[0].map(v => v * 0.8),
              ],
            })
          }
          className="p-2 bg-yellow-100 rounded hover:bg-yellow-200"
        >
          Decrease Distortion
        </button>
      </div>
    </div>
  );
};

// Example component to demonstrate usage
const UnskewTslExample: React.FC = () => {
  // For real usage, you would use the actual atoms from your application
  const [calibrationData, setCalibrationData] = useAtom(mockCalibrationDataAtom);
  const [videoSrc, setVideoSrc] = useAtom(mockVideoSrcAtom);

  return (
    <div className="p-4 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold mb-4">Video Undistortion with Three.js Shader</h1>

      <DebugPanel
        videoSrc={videoSrc}
        setVideoSrc={setVideoSrc}
        calibrationData={calibrationData}
        setCalibrationData={setCalibrationData}
      />

      <div className="border rounded overflow-hidden bg-black">
        <UnskewTsl width={800} height={600} />
      </div>

      <div className="mt-4 text-sm text-gray-600 p-4 bg-gray-50 rounded">
        <h3 className="font-bold mb-2">About this component:</h3>
        <p className="mb-2">
          This component uses <code>useVideoTexture</code> from @react-three/drei to load the video,
          and Three.js with GLSL shaders to perform real-time video undistortion based on OpenCV
          camera calibration parameters. The undistortion is calculated on the GPU for better
          performance.
        </p>
      </div>
    </div>
  );
};

export default UnskewTslExample;

// For simplicity in testing, you can wrap the example with Jotai provider
export const UnskewTslExampleWithProvider: React.FC = () => (
  <Provider>
    <UnskewTslExample />
  </Provider>
);
