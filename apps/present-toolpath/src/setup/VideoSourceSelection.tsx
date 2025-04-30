import { AtomsHydrator } from '@/lib/AtomsHydrator';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  buildConnectionUrl,
  generatePassword,
  genRandomWebrtc,
  RtcConnectionParams,
  UrlConnectionParams,
  WebcastConnectionParams,
  WebrtcConnectionParams,
  WebtorrentConnectionParams,
} from '@wbcnc/go2webrtc/url-helpers';
import { useVideoSource } from '@wbcnc/go2webrtc/video-source';
import { Button } from '@wbcnc/ui/components/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@wbcnc/ui/components/card';
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@wbcnc/ui/components/form';
import { Input } from '@wbcnc/ui/components/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@wbcnc/ui/components/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@wbcnc/ui/components/tabs';
import { Textarea } from '@wbcnc/ui/components/textarea';
import { atom, Provider, useAtom, useAtomValue } from 'jotai';
import { atomWithStorage } from 'jotai/utils';
import { ExternalLink } from 'lucide-react';
import { useQRCode } from 'next-qrcode';
import { useEffect, useRef, useState } from 'react';

import { useForm, UseFormReturn } from 'react-hook-form';
import { stringify } from 'yaml';
import { z } from 'zod';

const SERVE_URL = 'https://present-toolpath-webrtc-cam.vercel.app/webrtc-custom';

const sourceTypeAtom = atom<string>('rtc2go');

const shareNameAtom = atom<string>('');
const passwordAtom = atom<string>('');
const phoneConnectUrl = atomWithStorage<string>('phoneConnectUrl', genRandomWebrtc(), undefined, {
  getOnInit: true,
});
const urlAtom = atom<string>('');
const webcamDeviceIdAtom = atom<string | undefined>(undefined);

const connectionParamsAtom = atom<RtcConnectionParams>({ type: 'webcam', deviceId: '' });
const connectionTypeAtom = atom(
  get => get(connectionParamsAtom).type,
  (get, set, update: RtcConnectionParams['type']) => {
    switch (update) {
      case 'webtorrent':
        set(connectionParamsAtom, { type: 'webtorrent', share: '', pwd: '' });
        break;
      case 'url':
        set(connectionParamsAtom, { type: 'url', url: '' });
        break;
      case 'webcam':
        set(connectionParamsAtom, { type: 'webcam', deviceId: '' });
        break;
      case 'webrtc':
        set(connectionParamsAtom, { type: 'webrtc', share: '', pwd: '' });
        break;
      default:
        throw new Error();
    }
  }
);
const connectionUrlAtom = atom(get => buildConnectionUrl(get(connectionParamsAtom)));

const combinedUrlAtom = atom<string>(get => {
  const sourceType = get(sourceTypeAtom);
  switch (sourceType) {
    case 'webcam': {
      const deviceId = get(webcamDeviceIdAtom);
      if (!deviceId) return '';
      return buildConnectionUrl({ type: 'webcam', deviceId });
    }
    case 'phone':
      return get(phoneConnectUrl);
    case 'rtc2go':
      return buildConnectionUrl({ type: 'webtorrent', share: get(shareNameAtom), pwd: get(passwordAtom) });
    case 'url':
      return buildConnectionUrl({ type: 'url', url: get(urlAtom) });
    default:
      throw new Error(`Unknown source type: ${sourceType}`);
  }
});

const go2rtcSchema = z.object({
  share: z.string().min(10),
  pwd: z.string().min(10),
  type: z.literal('webtorrent'),
});

function Rtc2GoConfigTextarea({ form }: { form: UseFormReturn<z.infer<typeof go2rtcSchema>> }) {
  const { watch } = form;
  const share = watch('share');
  const pwd = watch('pwd');
  function getGo2rtcConfig() {
    if (!share || !pwd) {
      return '';
    }
    return stringify({
      webtorrent: {
        shares: {
          [share]: {
            pwd: pwd,
            src: 'your-stream-name-from-streams-section',
          },
        },
      },
    });
  }
  if (!share || !pwd) {
    return null;
  }

  return (
    <div className="grid w-full items-center gap-1.5">
      <div className="text-sm text-muted-foreground">Your go2rtc config should include the following:</div>
      <Textarea readOnly className="h-36" value={getGo2rtcConfig()} />
    </div>
  );
}

function Go2RtcTab({
  defaults,
  onSubmit,
}: {
  defaults: WebtorrentConnectionParams;
  onSubmit: (params: WebtorrentConnectionParams) => void;
}) {
  // const [params, setParams] = useAtom(connectionParamsAtom);
  // if (params.type !== 'webtorrent') throw new Error();
  const form = useForm<z.infer<typeof go2rtcSchema>>({
    resolver: zodResolver(go2rtcSchema),
    defaultValues: defaults,
  });

  // const [tracker, setTracker] = useState('wss://tracker.openwebtorrent.com');

  function onGenerateRandom() {
    form.setValue('share', crypto.randomUUID());
    form.setValue('pwd', generatePassword());
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
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
            <FormField
              control={form.control}
              name="share"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Share Name</FormLabel>
                  <FormControl>
                    <Input placeholder="globally unique string" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="pwd"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Password</FormLabel>
                  <FormControl>
                    <Input placeholder="password" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <Rtc2GoConfigTextarea form={form} />
            <div className="flex gap-2">
              <Button type="submit">Submit</Button>
              <Button onClick={onGenerateRandom} variant="secondary">
                Generate Random
              </Button>
            </div>
          </form>
        </Form>
        {/* <InputWithLabel label="Tracker" value={tracker} onChange={e => setTracker(e.target.value)} type="url" /> */}
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

function WebcamTab({ defaults }: { defaults: WebcastConnectionParams }) {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState(defaults.deviceId);

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
  }, [selectedDeviceId, setSelectedDeviceId]); // Rerun if selectedDeviceId was initially undefined and gets set

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
        {/* <WebcamPreview deviceId={selectedDeviceId} /> */}
      </CardContent>
    </Card>
  );
}

function ServeWebrtcQR({ params }: { params: WebrtcConnectionParams }) {
  const { SVG } = useQRCode();

  const searchParams = new URLSearchParams({
    share: params.share,
    pwd: params.pwd,
  });
  const url = `${SERVE_URL}?${searchParams.toString()}`;
  return <SVG text={url} />;
}

function PhoneTab({ defaults, onSubmit }: { defaults: WebrtcConnectionParams; onSubmit: (params: WebrtcConnectionParams) => void }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Phone via WebRTC</CardTitle>
        <CardDescription>Use an (old) phone as network camera source.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="w-[200px] h-[200px]">
          <ServeWebrtcQR params={defaults} />
        </div>
      </CardContent>
    </Card>
  );
}

const urlSchema = z.object({
  url: z.string().url(),
  type: z.literal('url'),
});

function UrlTab({ defaults, onSubmit }: { defaults: UrlConnectionParams; onSubmit: (params: UrlConnectionParams) => void }) {
  const form = useForm<z.infer<typeof urlSchema>>({
    resolver: zodResolver(urlSchema),
    defaultValues: defaults,
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>Video Stream URL</CardTitle>
        <CardDescription>Mainly intended for dev/testing purposes.</CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
            <FormField
              control={form.control}
              name="url"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Stream URL</FormLabel>
                  <FormControl>
                    <Input placeholder="https://example.com/stream.mp4" {...field} />
                  </FormControl>
                  <FormDescription>URL of the video stream you want to use. Only https URLs are supported.</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <Button type="submit">Submit</Button>
          </form>
        </Form>

        {/* <InputWithLabel type="url" label="Stream URL" value={url} onChange={e => setUrl(e.target.value)} /> */}
      </CardContent>
    </Card>
  );
}

function DebugType() {
  const [connectionUrl] = useAtom(connectionUrlAtom);
  return <div>{connectionUrl}</div>;
}

function DebugPreview() {
  const [combinedUrl] = useAtom(combinedUrlAtom);
  const vidSrc = useVideoSource(combinedUrl);
  const videoRef = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (!vidSrc || !videoRef.current) return;
    console.log('vidSrc updating', vidSrc);
    if (vidSrc instanceof MediaStream) {
      videoRef.current.srcObject = vidSrc;
    } else {
      videoRef.current.src = vidSrc;
    }
  }, [vidSrc]);
  if (!vidSrc) return null;
  return (
    <div>
      <video crossOrigin="anonymous" autoPlay playsInline muted className="h-full w-full object-cover" ref={videoRef} />
    </div>
  );
}

const stableWebrtcDefaults = { type: 'webrtc' as const, share: generatePassword(15), pwd: generatePassword(15) };

export function VideoSourceTabs() {
  const [sourceType, setSourceType] = useState<string>(useAtomValue(connectionTypeAtom));
  const [defaults] = useAtom(connectionParamsAtom);
  function onSubmit(params: RtcConnectionParams) {
    console.log('submit', params);
  }
  const urlDefaults = defaults.type === 'url' ? defaults : { type: 'url' as const, url: '' };
  const webtorrentDefaults: WebtorrentConnectionParams =
    defaults.type === 'webtorrent' ? defaults : { type: 'webtorrent' as const, share: '', pwd: '' };
  const webrtcDefaults: WebrtcConnectionParams = defaults.type === 'webrtc' ? defaults : stableWebrtcDefaults;
  const webcamDefaults: WebcastConnectionParams = defaults.type === 'webcam' ? defaults : { type: 'webcam' as const, deviceId: '' };
  return (
    <>
      <Tabs className="w-full" value={sourceType} onValueChange={setSourceType}>
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="webcam">Webcam</TabsTrigger>
          <TabsTrigger value="webrtc">Phone</TabsTrigger>
          <TabsTrigger value="webtorrent">IP Camera</TabsTrigger>
          <TabsTrigger value="url">URL</TabsTrigger>
        </TabsList>
        <TabsContent value="webcam">
          <WebcamTab defaults={webcamDefaults} />
        </TabsContent>
        <TabsContent value="webrtc">
          <PhoneTab defaults={webrtcDefaults} onSubmit={onSubmit} />
        </TabsContent>
        <TabsContent value="webtorrent">
          <Go2RtcTab defaults={webtorrentDefaults} onSubmit={onSubmit} />
        </TabsContent>
        <TabsContent value="url">
          <UrlTab defaults={urlDefaults} onSubmit={onSubmit} />
        </TabsContent>
      </Tabs>
      <DebugType />
      <DebugPreview />
    </>
  );
}

export function VideoSourceSelection() {
  return (
    <Provider>
      <AtomsHydrator atomValues={[[connectionParamsAtom, { type: 'url', url: 'https://hello.com/stream.mp4' }]]}>
        <VideoSourceTabs />
      </AtomsHydrator>
    </Provider>
  );
}
