import { generatePassword, genRandomWebtorrent, parseConnectionString } from '@wbcnc/go2webrtc/url-helpers';
import { Button } from '@wbcnc/ui/components/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@wbcnc/ui/components/card';
import { InputWithLabel } from '@wbcnc/ui/components/InputWithLabel';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@wbcnc/ui/components/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@wbcnc/ui/components/tabs';
import { Textarea } from '@wbcnc/ui/components/textarea';
import { ExternalLink } from 'lucide-react';
import { useQRCode } from 'next-qrcode';
import { useEffect, useRef, useState } from 'react';
import { stringify } from 'yaml';

const SERVE_URL = 'https://present-toolpath-webrtc-cam.vercel.app/webtorrent';

function Rtc2TGoTab() {
  const [shareName, setShareName] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  // const [tracker, setTracker] = useState('wss://tracker.openwebtorrent.com');

  function onGenerateRandom() {
    setShareName(crypto.randomUUID());
    setPassword(generatePassword());
  }

  function getGo2rtcConfig() {
    if (!shareName || !password) {
      return '';
    }
    return stringify({
      webtorrent: {
        shares: {
          [shareName]: {
            pwd: password,
            src: 'your-stream-name-from-streams-section',
          },
        },
      },
    });
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>IP Camera via go2rtc</CardTitle>
        <CardDescription>
          Use any IP camera via{' '}
          <a className="text-blue-500 hover:underline" href="https://github.com/AlexxIT/go2rtc?tab=readme-ov-file#module-webtorrent">
            go2rtc <ExternalLink className="size-4 inline-block" />
          </a>
          .
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        <InputWithLabel label="Share Name" value={shareName} onChange={e => setShareName(e.target.value)} />
        <InputWithLabel label="Password" value={password} onChange={e => setPassword(e.target.value)} />
        {/* <InputWithLabel label="Tracker" value={tracker} onChange={e => setTracker(e.target.value)} type="url" /> */}

        {shareName && password && (
          <div className="grid w-full items-center gap-1.5">
            <div className="text-sm text-muted-foreground">Your go2rtc config should include the following:</div>
            <Textarea readOnly className="h-36" value={getGo2rtcConfig()} />
          </div>
        )}
        <Button onClick={onGenerateRandom} variant="secondary">
          Generate Random
        </Button>
      </CardContent>
    </Card>
  );
}

interface WebcamPreviewProps {
  deviceId: string | undefined;
}

function WebcamPreview({ deviceId }: WebcamPreviewProps) {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  // Start/stop stream when selected device changes
  useEffect(() => {
    if (!deviceId) {
      // Clear stream if deviceId becomes undefined
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
        setStream(null);
      }
      return;
    }

    let currentStream: MediaStream;
    async function startStream() {
      try {
        // Stop previous stream if any
        if (stream) {
          stream.getTracks().forEach(track => track.stop());
        }
        currentStream = await navigator.mediaDevices.getUserMedia({ video: { deviceId: { exact: deviceId } } });
        setStream(currentStream);
      } catch (err) {
        console.error('Error starting video stream:', err);
        setStream(null); // Clear stream on error
      }
    }

    startStream();

    // Cleanup: stop the stream when the component unmounts or deviceId changes
    return () => {
      if (currentStream) {
        currentStream.getTracks().forEach(track => track.stop());
      }
      // Don't setStream(null) here if the component is unmounting
      // The stream will be stopped, but setting state might cause issues
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deviceId]); // Dependency array includes deviceId

  // Attach stream to video element
  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  if (!deviceId || !stream) {
    // Optionally, show a placeholder or loading state
    return (
      <div className="mt-4 flex aspect-video w-full items-center justify-center rounded-md border bg-muted text-muted-foreground">
        {deviceId ? 'Loading preview...' : 'No device selected'}
      </div>
    );
  }

  return (
    <div className="mt-4 aspect-video max-w-sm overflow-hidden rounded-md border bg-muted">
      <video ref={videoRef} autoPlay playsInline muted className="h-full w-full object-cover" />
    </div>
  );
}

function WebcamTab() {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | undefined>(undefined);

  // Get initial list of devices
  useEffect(() => {
    async function getDevices() {
      try {
        // Temporarily request permission to ensure all devices are listed, then stop the stream immediately
        const tempStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        const allDevices = await navigator.mediaDevices.enumerateDevices();
        const videoDevices = allDevices.filter(device => device.kind === 'videoinput');
        setDevices(videoDevices);
        if (videoDevices.length > 0 && !selectedDeviceId) {
          setSelectedDeviceId(videoDevices[0].deviceId);
        }
        tempStream.getTracks().forEach(track => track.stop()); // Stop the temporary stream
      } catch (err) {
        console.error('Error enumerating devices:', err);
      }
    }
    getDevices();
  }, [selectedDeviceId]); // Rerun if selectedDeviceId was initially undefined and gets set

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
        <WebcamPreview deviceId={selectedDeviceId} />
      </CardContent>
    </Card>
  );
}

function ServeWebtorrentQR({ webtorrent }: { webtorrent: string }) {
  const { SVG } = useQRCode();
  const parsed = parseConnectionString(webtorrent);
  if (!parsed) {
    return null;
  }
  const params = new URLSearchParams({
    share: parsed.share,
    pwd: parsed.pwd,
  });
  const url = `${SERVE_URL}?${params.toString()}`;
  return <SVG text={url} />;
}

function PhoneTab() {
  const { SVG } = useQRCode();
  const [webtorrent, setWebtorrent] = useState<string>('');
  useEffect(() => {
    setWebtorrent(genRandomWebtorrent());
  }, []);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Phone via WebRTC</CardTitle>
        <CardDescription>Use an (old) phone as network camera source.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="w-[200px] h-[200px]">
          <ServeWebtorrentQR webtorrent={webtorrent} />
        </div>
      </CardContent>
    </Card>
  );
}

function UrlTab() {
  const [url, setUrl] = useState<string>('');
  return (
    <Card>
      <CardHeader>
        <CardTitle>Video Stream URL</CardTitle>
        <CardDescription>Enter the URL of the video stream you want to use. Only https URLs are supported.</CardDescription>
      </CardHeader>
      <CardContent>
        <InputWithLabel label="Stream URL" value={url} onChange={e => setUrl(e.target.value)} />
      </CardContent>
    </Card>
  );
}

export function VideoSourceSelection() {
  return (
    <Tabs defaultValue="rtc2go" className="w-full">
      <TabsList className="grid w-full grid-cols-4">
        <TabsTrigger value="webcam">Webcam</TabsTrigger>
        <TabsTrigger value="phone">Phone</TabsTrigger>
        <TabsTrigger value="rtc2go">IP Camera</TabsTrigger>
        <TabsTrigger value="url">URL</TabsTrigger>
      </TabsList>
      <TabsContent value="webcam">
        <WebcamTab />
      </TabsContent>
      <TabsContent value="phone">
        <PhoneTab />
      </TabsContent>
      <TabsContent value="rtc2go">
        <Rtc2TGoTab />
      </TabsContent>
      <TabsContent value="url">
        <UrlTab />
      </TabsContent>
    </Tabs>
  );
}
