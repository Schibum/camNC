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
import { useVideoSource } from '@wbcnc/go2webrtc/video-source';
import { Button } from '@wbcnc/ui/components/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@wbcnc/ui/components/card';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogTitle } from '@wbcnc/ui/components/dialog';
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
  onConnect,
}: {
  defaults: WebtorrentConnectionParams;
  onConnect: (params: WebtorrentConnectionParams) => void;
}) {
  // const [params, setParams] = useAtom(connectionParamsAtom);
  // if (params.type !== 'webtorrent') throw new Error();
  const form = useForm<z.infer<typeof go2rtcSchema>>({
    resolver: zodResolver(go2rtcSchema),
    defaultValues: defaults,
  });

  // const [tracker, setTracker] = useState('wss://tracker.openwebtorrent.com');

  function onGenerateRandom(ev: React.MouseEvent<HTMLButtonElement>) {
    ev.preventDefault();
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
          <form onSubmit={form.handleSubmit(onConnect)} className="space-y-8">
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
        {selectedDeviceId && <VideoPreview connectionUrl={buildConnectionUrl({ type: 'webcam', deviceId: selectedDeviceId })} />}
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

function PhoneTab({ defaults, onConnect }: { defaults: WebrtcConnectionParams; onConnect: (params: WebrtcConnectionParams) => void }) {
  function connect() {
    onConnect(defaults);
  }

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
            <Button onClick={connect}>Connect</Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

const urlSchema = z.object({
  url: z.string().url(),
  type: z.literal('url'),
});

function UrlTab({ defaults, onConnect }: { defaults: UrlConnectionParams; onConnect: (params: UrlConnectionParams) => void }) {
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
          <form onSubmit={form.handleSubmit(onConnect)} className="space-y-8">
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

function VideoPreview({ connectionUrl, ...props }: { connectionUrl: string } & Omit<React.VideoHTMLAttributes<HTMLVideoElement>, 'src'>) {
  const { src } = useVideoSource(connectionUrl);

  if (!src) return <LoadingSpinner className="size-20" />;
  return <MediaSourceVideo src={src} {...props} />;
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
      className="h-auto w-fit-content object-contain rounded-md"
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

// Show a warning if the connection takes longer than 10 seconds
const kSlowConnectionWarningTimeout = 10000;

function ConnectDialog({ params, onConfirm, onCancel }: { params: RtcConnectionParams; onConfirm: () => void; onCancel: () => void }) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [slowWarning, setSlowWarning] = useState(false);
  const timeoutRef = useRef<number | null>(null);

  useEffect(() => {
    const timerId = window.setTimeout(() => {
      setSlowWarning(true);
    }, kSlowConnectionWarningTimeout);
    timeoutRef.current = timerId;
    return () => {
      if (timeoutRef.current !== null) {
        window.clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  function onError() {
    setHasError(true);
    clearSlowWarning();
  }

  function clearSlowWarning() {
    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current);
    }
    setSlowWarning(false);
  }

  function onPlaying() {
    setIsPlaying(true);
    clearSlowWarning();
  }
  return (
    <Dialog
      open={true}
      onOpenChange={v => {
        if (!v) onCancel();
      }}>
      <DialogContent className="max-w-none max-h-none sm:max-w-none sm:max-h-none w-full h-full md:w-[90%] md:h-[90%] flex flex-col">
        <DialogTitle>Video Source Preview</DialogTitle>
        <DialogDescription>
          {hasError && <span className="text-red-500">Failed to connect.</span>}
          {slowWarning && <span className="text-red-500">This is taking longer than expected. Something might be wrong.</span>}
          {!hasError && !slowWarning && !isPlaying && <span>Please wait while we connect to the video source.</span>}
          {isPlaying && <span>Confirm to use this video source.</span>}
        </DialogDescription>
        <div className="flex justify-center items-center flex-grow overflow-hidden">
          <VideoPreview
            className="max-w-full max-h-full"
            connectionUrl={buildConnectionUrl(params)}
            onPlaying={onPlaying}
            onError={onError}
          />
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="secondary">Cancel</Button>
          </DialogClose>
          <DialogClose asChild>
            <Button disabled={!isPlaying} onClick={onConfirm}>
              Confirm Video Source
            </Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function VideoSourceTabs() {
  const [sourceType, setSourceType] = useState<string>(useAtomValue(connectionTypeAtom));
  const [defaults, setConnectionParams] = useAtom(connectionParamsAtom);
  const [connectParams, setConnectParams] = useState<RtcConnectionParams | null>(null);

  function onSubmit(params: RtcConnectionParams) {
    setConnectParams(null);
    console.log('submit', params);
    setConnectionParams(params);
  }

  function onConnect(params: RtcConnectionParams) {
    setConnectParams(params);
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
          <PhoneTab defaults={webrtcDefaults} onConnect={onConnect} />
        </TabsContent>
        <TabsContent value="webtorrent">
          <Go2RtcTab defaults={webtorrentDefaults} onConnect={onConnect} />
        </TabsContent>
        <TabsContent value="url">
          <UrlTab defaults={urlDefaults} onConnect={onConnect} />
        </TabsContent>
      </Tabs>
      {connectParams && (
        <ConnectDialog params={connectParams} onConfirm={() => onSubmit(connectParams)} onCancel={() => setConnectParams(null)} />
      )}
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
