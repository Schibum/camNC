import {
  buildRtspUrl,
  CameraStream,
  cameraLabel,
  discoverCameras,
  FoundCamera,
  kRtspPresets,
  onvifStreams,
} from '@/lib/desktop/network-cameras';
import { zodResolver } from '@hookform/resolvers/zod';
import { RtspConnectionParams } from '@wbcnc/go2webrtc/url-helpers';
import { Button } from '@wbcnc/ui/components/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@wbcnc/ui/components/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@wbcnc/ui/components/collapsible';
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@wbcnc/ui/components/form';
import { Input } from '@wbcnc/ui/components/input';
import { Label } from '@wbcnc/ui/components/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@wbcnc/ui/components/select';
import { Camera, ChevronDown, Loader2, RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

const schema = z.object({
  url: z
    .string()
    .trim()
    .regex(/^rtsps?:\/\/[^/\s]+/i, 'Enter an rtsp:// URL, e.g. rtsp://admin:password@192.168.1.20:554/h264Preview_01_main'),
  type: z.literal('rtsp'),
});

/** `name` is the camera's own name, when discovery found one. */
type OnConnect = (params: RtspConnectionParams, name?: string) => void;

function hostOf(url: string) {
  return /^rtsps?:\/\/(?:[^@/]*@)?([^:/?#]+)/i.exec(url)?.[1] ?? null;
}

/** The found cameras, searched for once when the tab opens. */
function useCameraSearch() {
  const [cameras, setCameras] = useState<FoundCamera[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function search() {
    setSearching(true);
    setError(null);
    try {
      setCameras(await discoverCameras());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSearching(false);
    }
  }
  useEffect(() => {
    void search();
  }, []);
  return { cameras, searching, error, search };
}

function StreamChoice({ streams, value, onChange }: { streams: CameraStream[]; value: string; onChange: (url: string) => void }) {
  return (
    <div className="flex flex-col gap-1">
      <Label>Stream</Label>
      {streams.map(stream => (
        <label key={stream.url} className="flex flex-row items-center gap-2 text-sm">
          <input type="radio" name="stream" checked={value === stream.url} onChange={() => onChange(stream.url)} />
          {stream.name}
          {stream.width && stream.height && (
            <span className="text-muted-foreground">
              {stream.width}×{stream.height}
            </span>
          )}
        </label>
      ))}
    </div>
  );
}

/** Login and stream choice for one found camera. ONVIF cameras list their own streams; others use a preset path. */
function CameraLogin({ camera, onConnect }: { camera: FoundCamera; onConnect: OnConnect }) {
  const [user, setUser] = useState('admin');
  const [password, setPassword] = useState('');
  const [streams, setStreams] = useState<CameraStream[] | null>(null);
  const [streamUrl, setStreamUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Without ONVIF, or when it fails, the stream is one of the usual paths.
  const [usePreset, setUsePreset] = useState(!camera.onvifUrl);
  const [path, setPath] = useState<string>(kRtspPresets[0].path);

  async function logIn() {
    if (!camera.onvifUrl) return;
    setBusy(true);
    setError(null);
    try {
      const found = await onvifStreams(camera.onvifUrl, user, password);
      setStreams(found);
      setStreamUrl(found[0]!.url);
    } catch (e) {
      setError((e as Error).message);
      // ONVIF may be switched off while RTSP works.
      if (camera.rtsp) setUsePreset(true);
    } finally {
      setBusy(false);
    }
  }

  function connect() {
    const url = usePreset ? buildRtspUrl(camera.host, user, password, path) : streamUrl;
    if (url) onConnect({ type: 'rtsp', url }, camera.name || camera.hardware ? cameraLabel(camera) : undefined);
  }

  return (
    <div className="flex flex-col gap-4 rounded-md border p-3">
      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-1">
          <Label htmlFor="camera-user">Username</Label>
          <Input id="camera-user" autoComplete="off" value={user} onChange={e => setUser(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="camera-password">Password</Label>
          <Input
            id="camera-password"
            type="password"
            autoComplete="off"
            value={password}
            onChange={e => {
              setPassword(e.target.value);
              setStreams(null);
            }}
          />
        </div>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      {!usePreset && !streams && (
        <div className="flex flex-row items-center gap-2">
          <Button onClick={logIn} disabled={busy}>
            {busy && <Loader2 className="animate-spin" />} Log in
          </Button>
          {camera.rtsp && (
            <Button variant="link" onClick={() => setUsePreset(true)}>
              Pick the stream path instead
            </Button>
          )}
        </div>
      )}
      {!usePreset && streams && <StreamChoice streams={streams} value={streamUrl} onChange={setStreamUrl} />}
      {usePreset && (
        <div className="flex flex-col gap-1">
          <Label>Camera type</Label>
          <Select value={path} onValueChange={setPath}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {kRtspPresets.map(preset => (
                <SelectItem key={preset.path} value={preset.path}>
                  {preset.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-sm text-muted-foreground">Another brand? Enter its RTSP URL below.</p>
        </div>
      )}
      {(usePreset || streams) && (
        <div>
          <Button onClick={connect}>Connect</Button>
        </div>
      )}
    </div>
  );
}

function ManualUrlForm({ defaults, onConnect }: { defaults: RtspConnectionParams; onConnect: OnConnect }) {
  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: defaults,
  });
  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(values => onConnect(values))} className="space-y-4">
        <FormField
          control={form.control}
          name="url"
          render={({ field }) => (
            <FormItem>
              <FormLabel>RTSP URL</FormLabel>
              <FormControl>
                <Input placeholder="rtsp://admin:password@192.168.1.20:554/h264Preview_01_main" autoComplete="off" {...field} />
              </FormControl>
              <FormDescription>
                Special characters in the password must be URL-encoded, e.g. <code>$</code> as <code>%24</code>.
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button type="submit">Connect</Button>
      </form>
    </Form>
  );
}

/** Desktop app only: the camera's own RTSP stream, played through the go2rtc bundled with the app. */
export function RtspTab({ defaults, onConnect }: { defaults: RtspConnectionParams; onConnect: OnConnect }) {
  const { cameras, searching, error, search } = useCameraSearch();
  const currentHost = defaults.url ? hostOf(defaults.url) : null;
  const [selected, setSelected] = useState<string | null>(null);
  const [manualOpen, setManualOpen] = useState(!!defaults.url);
  const selectedCamera = cameras?.find(c => c.host === selected);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Network camera</CardTitle>
        <CardDescription>
          Connect directly to an IP camera on your network, such as a Reolink. The desktop app streams it through its built-in go2rtc, so
          nothing else needs to be installed.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-row items-center justify-between">
          <Label>Cameras on your network</Label>
          <Button variant="ghost" size="sm" onClick={search} disabled={searching}>
            {searching ? <Loader2 className="animate-spin" /> : <RefreshCw />} {searching ? 'Searching…' : 'Search again'}
          </Button>
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        {cameras && cameras.length === 0 && !searching && (
          <p className="text-sm text-muted-foreground">
            No cameras found. Make sure the camera is on the same network, or enter its RTSP URL below.
          </p>
        )}
        {cameras && cameras.length > 0 && (
          <ul className="flex flex-col gap-1">
            {cameras.map(camera => (
              <li key={camera.host}>
                <button
                  type="button"
                  className={`flex w-full flex-row items-center gap-2 rounded-md border px-3 py-2 text-left text-sm hover:bg-accent ${
                    selected === camera.host ? 'border-primary' : ''
                  }`}
                  onClick={() => setSelected(camera.host)}>
                  <Camera className="size-4 shrink-0" />
                  <span className="font-medium">{cameraLabel(camera)}</span>
                  <span className="text-muted-foreground">{camera.host}</span>
                  {camera.host === currentHost && <span className="ml-auto text-muted-foreground">current</span>}
                </button>
                {selected === camera.host && selectedCamera && (
                  <div className="mt-2">
                    <CameraLogin key={camera.host} camera={selectedCamera} onConnect={onConnect} />
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
        <Collapsible open={manualOpen} onOpenChange={setManualOpen}>
          <CollapsibleTrigger asChild>
            <Button variant="link" className="px-0">
              <ChevronDown className={manualOpen ? 'rotate-180' : ''} /> Enter an RTSP URL
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <ManualUrlForm defaults={defaults} onConnect={onConnect} />
          </CollapsibleContent>
        </Collapsible>
      </CardContent>
    </Card>
  );
}
