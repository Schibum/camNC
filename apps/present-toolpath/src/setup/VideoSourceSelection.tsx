import { AtomsHydrator } from '@/lib/AtomsHydrator';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  buildConnectionUrl,
  generatePassword,
  genRandomWebrtc,
  parseConnectionString,
  RtcConnectionParams,
  UrlConnectionParams,
  WebcamConnectionParams,
  WebrtcConnectionParams,
  WebtorrentConnectionParams,
} from '@wbcnc/go2webrtc/url-helpers';
import { useVideoSource, VideoSource, videoSource } from '@wbcnc/go2webrtc/video-source';
import { Button } from '@wbcnc/ui/components/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@wbcnc/ui/components/card';
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@wbcnc/ui/components/form';
import { Input } from '@wbcnc/ui/components/input';
import { LoadingSpinner } from '@wbcnc/ui/components/loading-spinner';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@wbcnc/ui/components/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@wbcnc/ui/components/tabs';
import { Textarea } from '@wbcnc/ui/components/textarea';
import { atom, Provider, useAtom, useAtomValue } from 'jotai';
import { ExternalLink } from 'lucide-react';
import { useQRCode } from 'next-qrcode';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';

import { useForm, UseFormReturn } from 'react-hook-form';
import { stringify } from 'yaml';
import { z } from 'zod';

const SERVE_URL = 'https://present-toolpath-webrtc-cam.vercel.app/webrtc-custom';

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

function WebcamTab({ defaults, onSubmit }: { defaults: WebcamConnectionParams; onSubmit: (params: WebcamConnectionParams) => void }) {
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
        <VideoPreview connectionUrl={buildConnectionUrl({ type: 'webcam', deviceId: selectedDeviceId })} />
        <Button onClick={() => onSubmit({ type: 'webcam', deviceId: selectedDeviceId })}>Confirm</Button>
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
  const [hasClickedConnect, setHasClickedConnect] = useState(false);
  const sourceRef = useRef<VideoSource | null>(null);
  const [src, setSrc] = useState<MediaStream | string | null>(null);

  function connect() {
    setHasClickedConnect(true);
    sourceRef.current = videoSource(buildConnectionUrl({ type: 'webrtc', share: defaults.share, pwd: defaults.pwd }));
    sourceRef.current.connectedPromise.then(info => {
      setSrc(info.src);
    });
  }
  useEffect(() => {
    return () => {
      sourceRef.current?.dispose();
    };
  }, []);

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
        <div className="flex flex-col gap-4">
          <div className="text-sm text-muted-foreground">Scan the QR code with the phone to use as a camera, then click Connect.</div>
          <div>
            <Button onClick={connect} disabled={hasClickedConnect}>
              Connect {hasClickedConnect && !src && <LoadingSpinner className="size-4 inline-block" />}
            </Button>
          </div>
          {hasClickedConnect && src && <MediaSourceVideo src={src} />}
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

function VideoPreview({ connectionUrl }: { connectionUrl: string }) {
  const { src } = useVideoSource(connectionUrl);

  if (!src) return <LoadingSpinner />;
  return <MediaSourceVideo src={src} />;
}

function MediaSourceVideo({ src, ...props }: { src: string | MediaStream } & Omit<React.VideoHTMLAttributes<HTMLVideoElement>, 'src'>) {
  const videoRef = useRef<HTMLVideoElement>(null);
  useLayoutEffect(() => {
    if (!src || !videoRef.current) return;
    if (src instanceof MediaStream) {
      videoRef.current.srcObject = src;
    } else {
      videoRef.current.src = src;
    }
  }, [src]);
  return (
    <video
      crossOrigin="anonymous"
      autoPlay
      playsInline
      muted
      className="h-auto w-fit-content object-contain max-w-sm max-h-[300px] rounded-md"
      {...props}
      ref={videoRef}
    />
  );
}

function getStableWebrtcDefaults() {
  let url = localStorage.getItem('webrtcDefaults');
  if (!url) {
    url = genRandomWebrtc();
    localStorage.setItem('webrtcDefaults', url);
  }
  const parsed = parseConnectionString(url);
  if (parsed.type !== 'webrtc') {
    throw new Error('Invalid webrtc defaults');
  }
  return parsed as WebrtcConnectionParams;
}

export function VideoSourceTabs() {
  const [sourceType, setSourceType] = useState<string>(useAtomValue(connectionTypeAtom));
  const [defaults, setConnectionParams] = useAtom(connectionParamsAtom);
  function onSubmit(params: RtcConnectionParams) {
    console.log('submit', params);
    setConnectionParams(params);
  }
  const urlDefaults = defaults.type === 'url' ? defaults : { type: 'url' as const, url: '' };
  const webtorrentDefaults: WebtorrentConnectionParams =
    defaults.type === 'webtorrent' ? defaults : { type: 'webtorrent' as const, share: '', pwd: '' };
  const webrtcDefaults: WebrtcConnectionParams = defaults.type === 'webrtc' ? defaults : getStableWebrtcDefaults();
  const webcamDefaults: WebcamConnectionParams = defaults.type === 'webcam' ? defaults : { type: 'webcam' as const, deviceId: '' };
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
          <WebcamTab defaults={webcamDefaults} onSubmit={onSubmit} />
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
