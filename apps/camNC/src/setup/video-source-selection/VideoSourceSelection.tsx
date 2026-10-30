import { Hint } from '@/components/Hint';
import { isDesktopApp } from '@/lib/desktop/is-desktop';
import {
  buildConnectionUrl,
  genRandomWebrtc,
  Go2rtcConnectionParams,
  parseConnectionString,
  RtcConnectionParams,
  RtspConnectionParams,
  WebcamConnectionParams,
  WebrtcConnectionParams,
  WebtorrentConnectionParams,
} from '@wbcnc/go2webrtc/url-helpers';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@wbcnc/ui/components/tabs';
import { useMemo, useState } from 'react';

import { Form, Input } from '@heroui/react';
import { VideoDimensions } from '@wbcnc/go2webrtc/video-source';
import { ConnectDialog } from './ConnectDialog';
import { Go2RtcLocalTab } from './Go2RtcLocalTab';
import { Go2RtcWebtorrentTab } from './Go2RtcWebtorrentTab';
import { PhoneTab } from './PhoneTab';
import { RtspTab } from './RtspTab';
import { UrlTab } from './UrlTab';
import { WebcamTab } from './WebcamTab';

function getRandomWebrtcDefaults(): WebrtcConnectionParams {
  return parseConnectionString(genRandomWebrtc()) as WebrtcConnectionParams;
}

export interface IOnChangeArgs {
  url: string;
  maxResolution: VideoDimensions;
  name: string;
}

export function VideoSourceSelection({
  value = '',
  onChange,
  defaultName,
}: {
  value?: string;
  onChange: (value: IOnChangeArgs) => void;
  defaultName: string;
}) {
  const defaults = useMemo(() => {
    try {
      if (value) {
        return parseConnectionString(value);
      }
    } catch {
      // ignore
    }
    return undefined;
  }, [value]);

  // The desktop app plays network cameras through its own go2rtc, so the external go2rtc tabs only stay for a camera
  // that still uses one.
  const showGo2rtc = !isDesktopApp() || defaults?.type === 'go2rtc';
  const showWebtorrent = !isDesktopApp() || defaults?.type === 'webtorrent';
  const [sourceType, setSourceType] = useState<string>(defaults?.type || (isDesktopApp() ? 'rtsp' : 'webrtc'));
  const [connectParams, setConnectParams] = useState<RtcConnectionParams | null>(null);
  const [name, setName] = useState<string>(defaultName);
  function onSubmit(params: RtcConnectionParams, maxResolution: VideoDimensions) {
    setConnectParams(null);
    console.log('VideoSourceSelection onSubmit', params, maxResolution);
    onChange({ url: buildConnectionUrl(params), maxResolution, name });
  }

  function onConnect(params: RtcConnectionParams) {
    setConnectParams(params);
  }

  const urlDefaults = defaults?.type === 'url' ? defaults : { type: 'url' as const, url: '' };
  const webtorrentDefaults: WebtorrentConnectionParams =
    defaults?.type === 'webtorrent' ? defaults : { type: 'webtorrent' as const, share: '', pwd: '' };
  const webrtcDefaults = useMemo<WebrtcConnectionParams>(
    () => (defaults?.type === 'webrtc' ? defaults : getRandomWebrtcDefaults()),
    [defaults]
  );
  const webcamDefaults: WebcamConnectionParams =
    defaults?.type === 'webcam' ? defaults : { type: 'webcam' as const, deviceId: '', idealWidth: 4096, idealHeight: 2160 };
  const rtspDefaults: RtspConnectionParams = defaults?.type === 'rtsp' ? defaults : { type: 'rtsp' as const, url: '' };
  const go2rtcDefaults: Go2rtcConnectionParams =
    defaults?.type === 'go2rtc' ? defaults : { type: 'go2rtc' as const, host: 'localhost:1984', src: 'camera1' };

  return (
    <>
      <Hint title="Camera Setup">
        <p className="mb-1">
          Position a camera above the machine so the full working area is visible. Repurposing an old phone works well and you can 3D print
          <a
            href="https://makerworld.com/en/models/1455114-ceiling-top-down-phone-mount-with-ball-joint#profileId-1516416"
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-500 hover:underline mx-1">
            this mount
          </a>
          for an easy setup.
        </p>
        <p className="mb-1">
          A Reolink E1 Zoom is also suitable
          <a
            href="https://makerworld.com/en/models/1461605-reolink-e1-zoom-ceiling-down-mount-looking-down#profileId-1524062"
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-500 hover:underline mx-1">
            (mount)
          </a>
          {isDesktopApp() ? (
            <>, and the desktop app connects to it directly under Network camera.</>
          ) : (
            <>
              , but it requires running
              <a
                href="https://github.com/AlexxIT/go2rtc"
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-500 hover:underline mx-1">
                go2rtc
              </a>
              as a gateway, e.g. on a Raspberry&nbsp;Pi&nbsp;Zero.
            </>
          )}
        </p>
        {!isDesktopApp() && (
          <p className="mb-1">
            <strong>Note:</strong> Prefer the local go2rtc version when possible, since it has lower connection latency and does not depend
            on torrent tracker uptime.
          </p>
        )}
      </Hint>

      <Form>
        <Input value={name} onChange={e => setName(e.target.value)} label="Name of camera/machine setup" isRequired />
      </Form>
      <Tabs className="w-full" value={sourceType} onValueChange={setSourceType}>
        <TabsList className="w-full">
          {isDesktopApp() && (
            <TabsTrigger value="rtsp" className="flex-auto whitespace-normal">
              Network camera
            </TabsTrigger>
          )}
          <TabsTrigger value="webcam" className="flex-auto whitespace-normal">
            Webcam
          </TabsTrigger>
          <TabsTrigger value="webrtc" className="flex-auto whitespace-normal">
            Phone
          </TabsTrigger>
          {showGo2rtc && (
            <TabsTrigger value="go2rtc" className="flex-auto whitespace-normal">
              go2rtc (local)
            </TabsTrigger>
          )}
          {showWebtorrent && (
            <TabsTrigger value="webtorrent" className="flex-auto whitespace-normal">
              go2rtc (webtorrent)
            </TabsTrigger>
          )}
          <TabsTrigger value="url" className="flex-auto whitespace-normal">
            URL
          </TabsTrigger>
        </TabsList>
        {isDesktopApp() && (
          <TabsContent value="rtsp">
            <RtspTab defaults={rtspDefaults} onConnect={onConnect} />
          </TabsContent>
        )}
        <TabsContent value="webcam">
          <WebcamTab defaults={webcamDefaults} onSubmit={onSubmit} />
        </TabsContent>
        <TabsContent value="webrtc">
          <PhoneTab defaults={webrtcDefaults} onConnect={onConnect} />
        </TabsContent>
        {showGo2rtc && (
          <TabsContent value="go2rtc">
            <Go2RtcLocalTab defaults={go2rtcDefaults} onConnect={onConnect} />
          </TabsContent>
        )}
        {showWebtorrent && (
          <TabsContent value="webtorrent">
            <Go2RtcWebtorrentTab defaults={webtorrentDefaults} onConnect={onConnect} />
          </TabsContent>
        )}
        <TabsContent value="url">
          <UrlTab defaults={urlDefaults} onConnect={onConnect} />
        </TabsContent>
      </Tabs>
      {connectParams && (
        <ConnectDialog
          params={connectParams}
          onConfirm={maxResolution => onSubmit(connectParams, maxResolution)}
          onCancel={() => setConnectParams(null)}
        />
      )}
    </>
  );
}
