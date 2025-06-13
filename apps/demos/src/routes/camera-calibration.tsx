import { createFileRoute } from '@tanstack/react-router';
import { CameraCalibration } from '@wbcnc/camera-calibration';
import { ensureOpenCvIsLoaded } from '@wbcnc/load-opencv';
import { Check, Settings } from 'lucide-react';
import { use, useCallback, useEffect, useState } from 'react';
// import "./index.css";

export const Route = createFileRoute('/camera-calibration')({
  component: RouteComponent,
});

function RouteComponent() {
  use(ensureOpenCvIsLoaded());
  return <App />;
}

// Settings component
interface SettingsOverlayProps {
  onSelectSource: (source: MediaStream | string | null) => void;
  currentSource: 'webcam' | 'url' | null;
}

function SettingsOverlay({ onSelectSource, currentSource }: SettingsOverlayProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [videoUrl, setVideoUrl] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [videoDevices, setVideoDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);

  // Fetch available devices when the settings are opened
  useEffect(() => {
    if (isOpen) {
      loadVideoDevices();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const loadVideoDevices = useCallback(async () => {
    try {
      // First request permission to access devices
      await navigator.mediaDevices.getUserMedia({ video: true });

      // Then enumerate devices
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoInputs = devices.filter(device => device.kind === 'videoinput');
      setVideoDevices(videoInputs);

      // Set first device as selected if none is selected
      if (videoInputs.length > 0 && !selectedDeviceId && videoInputs[0]) {
        setSelectedDeviceId(videoInputs[0].deviceId);
      }
    } catch (err) {
      console.error('Error enumerating video devices:', err);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleDeviceSelect = async (deviceId: string) => {
    setIsLoading(true);
    try {
      // Check if user is on mobile device
      const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

      // Set resolution based on device type
      const videoConstraints = isMobile
        ? {
            deviceId: { exact: deviceId },
            width: { ideal: 1920 }, // 1080p for mobile
            height: { ideal: 1080 },
          }
        : {
            deviceId: { exact: deviceId },
            width: { ideal: 3840 }, // 4K for desktop
            height: { ideal: 2160 },
          };

      const stream = await navigator.mediaDevices.getUserMedia({
        video: videoConstraints,
      });

      setSelectedDeviceId(deviceId);
      onSelectSource(stream);
      setIsOpen(false);
    } catch (err) {
      console.error('Error accessing camera at high resolution, trying lower resolution', err);
      try {
        // Fallback to standard resolution
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            deviceId: { exact: deviceId },
          },
        });
        setSelectedDeviceId(deviceId);
        onSelectSource(stream);
        setIsOpen(false);
      } catch (fallbackErr) {
        console.error('Error accessing camera', fallbackErr);
        alert('Could not access the selected camera. Please try another device.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleUrlSelect = () => {
    if (videoUrl.trim()) {
      onSelectSource(videoUrl.trim());
      setIsOpen(false);
    } else {
      alert('Please enter a valid video URL');
    }
  };

  return (
    <>
      <button
        className="absolute bottom-4 right-4 z-50 bg-gray-800 bg-opacity-70 rounded-full p-3 text-white"
        onClick={() => setIsOpen(!isOpen)}>
        <Settings className="h-6 w-6" />
      </button>

      {isOpen && (
        <div className="absolute inset-0 z-40 bg-black bg-opacity-80 flex items-center justify-center p-4">
          <div className="bg-gray-800 rounded-lg p-6 max-w-md w-full max-h-[80vh] overflow-y-auto">
            <h2 className="text-white text-xl font-bold mb-4">Video Source Settings</h2>

            <div className="space-y-4">
              <h3 className="text-white text-lg font-semibold">Camera Devices</h3>

              {isLoading ? (
                <div className="py-4 text-center text-white">Loading cameras...</div>
              ) : videoDevices.length > 0 ? (
                <div className="space-y-2 max-h-[40vh] overflow-y-auto">
                  {videoDevices.map(device => (
                    <button
                      key={device.deviceId}
                      className={`w-full py-2 px-4 rounded ${selectedDeviceId === device.deviceId && currentSource === 'webcam' ? 'bg-blue-600' : 'bg-gray-600'} text-white flex justify-between items-center`}
                      onClick={() => handleDeviceSelect(device.deviceId)}
                      disabled={isLoading}>
                      <span>{device.label || `Camera ${videoDevices.indexOf(device) + 1}`}</span>
                      {selectedDeviceId === device.deviceId && currentSource === 'webcam' && <Check className="h-5 w-5" />}
                    </button>
                  ))}
                </div>
              ) : (
                <div className="py-4 text-center text-white">No camera devices found</div>
              )}

              <div className="pt-2">
                <h3 className="text-white text-lg font-semibold mb-2">Video URL</h3>
                <div className={`w-full py-2 px-4 rounded ${currentSource === 'url' ? 'bg-blue-600' : 'bg-gray-600'} text-white`}>
                  <div className="flex justify-between items-center">
                    <span>Stream URL</span>
                    {currentSource === 'url' && <Check className="h-5 w-5" />}
                  </div>
                  <input
                    type="text"
                    className="w-full mt-2 px-3 py-2 bg-gray-700 text-white rounded"
                    placeholder="Enter video URL"
                    value={videoUrl}
                    onChange={e => setVideoUrl(e.target.value)}
                  />
                  <button className="mt-2 w-full py-1 px-3 bg-blue-500 text-white rounded" onClick={handleUrlSelect}>
                    Set URL
                  </button>
                </div>
              </div>
            </div>

            <div className="mt-4 flex justify-end">
              <button className="py-2 px-4 bg-gray-600 text-white rounded" onClick={() => setIsOpen(false)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function App() {
  const [videoSource, setVideoSource] = useState<MediaStream | string | null>(null);
  const [sourceType, setSourceType] = useState<'webcam' | 'url' | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Request webcam stream by default
  useEffect(() => {
    const getWebcamStream = async () => {
      try {
        const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

        // Set resolution based on device type
        const videoConstraints: MediaTrackConstraints = isMobile
          ? {
              width: { ideal: 1920 }, // 1080p for mobile
              height: { ideal: 1080 },
            }
          : {
              width: { ideal: 3840 }, // 4K for desktop
              height: { ideal: 2160 },
            };
        videoConstraints.facingMode = 'environment';

        const stream = await navigator.mediaDevices.getUserMedia({
          video: videoConstraints,
        });
        setVideoSource(stream);
        setSourceType('webcam');
      } catch (err) {
        console.error('Error accessing camera at high resolution, trying lower resolution', err);
        try {
          // Fallback to standard resolution with any camera
          const stream = await navigator.mediaDevices.getUserMedia({
            video: true,
          });
          setVideoSource(stream);
          setSourceType('webcam');
        } catch (fallbackErr) {
          console.error('Error accessing camera', fallbackErr);
          setError('Could not access camera. Please ensure camera access is allowed.');
        }
      }
    };

    getWebcamStream();

    // Cleanup
    return () => {
      if (videoSource instanceof MediaStream) {
        videoSource.getTracks().forEach(track => track.stop());
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Handle source change
  const handleSourceChange = (source: MediaStream | string | null) => {
    // Clean up previous stream if it was a MediaStream
    if (videoSource instanceof MediaStream) {
      videoSource.getTracks().forEach(track => track.stop());
    }

    if (source instanceof MediaStream) {
      setVideoSource(source);
      setSourceType('webcam');
    } else if (typeof source === 'string') {
      setVideoSource(source);
      setSourceType('url');
    } else {
      setVideoSource(null);
      setSourceType(null);
    }
  };

  // Handle calibration completion
  const handleCalibrationDone = (result: any) => {
    console.log('Calibration complete:', result);
    // Save or use the calibration result
  };

  if (error) {
    return <div className="error-message">{error}</div>;
  }

  if (!window.cv) throw new Error('OpenCV is not loaded');

  return (
    <div className="app-container w-screen h-[100dvh] overflow-hidden bg-gray-900 flex flex-col relative">
      {videoSource ? (
        <div className="flex-grow pb-[env(safe-area-inset-bottom)] overflow-hidden">
          <CameraCalibration
            src={videoSource}
            onCalibrationConfirmed={handleCalibrationDone}
            autoCapture={true}
            patternSize={{ width: 9, height: 6 }}
            // stabilityThreshold={10}
          />
          <SettingsOverlay onSelectSource={handleSourceChange} currentSource={sourceType} />
        </div>
      ) : (
        <div className="loading-message">
          Accessing camera...
          <SettingsOverlay onSelectSource={handleSourceChange} currentSource={sourceType} />
        </div>
      )}
    </div>
  );
}
