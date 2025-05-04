import { buildConnectionUrl, WebcamConnectionParams } from '@wbcnc/go2webrtc/url-helpers';
import { VideoDimensions } from '@wbcnc/go2webrtc/video-source';
import { Button } from '@wbcnc/ui/components/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@wbcnc/ui/components/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@wbcnc/ui/components/select';
import { useEffect, useRef, useState } from 'react';
import { VideoPreview, VideoPreviewRef } from './VideoPreview';

export function WebcamTab({
  defaults,
  onSubmit,
}: {
  defaults: WebcamConnectionParams;
  onSubmit: (params: WebcamConnectionParams, maxResolution?: VideoDimensions) => void;
}) {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState(defaults.deviceId);
  const videoPreviewRef = useRef<VideoPreviewRef>(null);

  // Get initial list of devices once on mount
  useEffect(() => {
    async function getDevices() {
      try {
        // Temporarily request permission to ensure all devices are listed, then stop the stream immediately
        const tempStream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: defaults.idealWidth }, height: { ideal: defaults.idealHeight } },
          audio: false,
        });
        tempStream.getTracks().forEach(track => track.stop()); // Stop the temporary stream
        const allDevices = await navigator.mediaDevices.enumerateDevices();
        const videoDevices = allDevices.filter(device => device.kind === 'videoinput');
        setDevices(videoDevices);
      } catch (err) {
        console.error('Error enumerating devices:', err);
      }
    }
    getDevices();
  }, []);

  // Automatically pick first device if none selected
  useEffect(() => {
    if (devices.length > 0 && !selectedDeviceId) {
      setSelectedDeviceId(devices[0].deviceId);
    }
  }, [devices, selectedDeviceId]);

  function getParams() {
    return {
      type: 'webcam',
      deviceId: selectedDeviceId,
      ...(defaults.idealWidth && defaults.idealHeight ? { idealWidth: defaults.idealWidth, idealHeight: defaults.idealHeight } : {}),
    } as const;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Webcam</CardTitle>
        <CardDescription>Select an available webcam connected to your computer.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {devices.length > 0 ? (
          <Select value={selectedDeviceId} onValueChange={setSelectedDeviceId}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Select a webcam" />
            </SelectTrigger>
            <SelectContent>
              {devices.map(device => (
                <SelectItem key={device.deviceId} value={device.deviceId}>
                  {device.label || `Camera ${devices.indexOf(device) + 1}`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <div className="text-sm text-muted-foreground">
            No webcams found or permission denied. Please ensure your webcam is connected and permissions are granted.
          </div>
        )}
        {selectedDeviceId && <VideoPreview connectionUrl={buildConnectionUrl(getParams())} ref={videoPreviewRef} />}
        <Button disabled={!selectedDeviceId} onClick={() => onSubmit(getParams(), videoPreviewRef.current?.maxResolution)}>
          Confirm
        </Button>
      </CardContent>
    </Card>
  );
}
