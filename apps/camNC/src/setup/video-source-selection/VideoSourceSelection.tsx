import {
  buildConnectionUrl,
  genRandomWebrtc,
  parseConnectionString,
  RtcConnectionParams,
  WebcamConnectionParams,
  WebrtcConnectionParams,
  WebtorrentConnectionParams,
} from '@wbcnc/go2webrtc/url-helpers';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@wbcnc/ui/components/tabs';
import { useMemo, useState } from 'react';
import { Hint } from '@/components/Hint';

import { VideoDimensions } from '@wbcnc/go2webrtc/video-source';
import { ConnectDialog } from './ConnectDialog';
import { Go2RtcTab } from './Go2RtcTab';
import { PhoneTab } from './PhoneTab';
import { UrlTab } from './UrlTab';
import { WebcamTab } from './WebcamTab';

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

export interface IOnChangeArgs {
  url: string;
  maxResolution: VideoDimensions;
}

export function VideoSourceSelection({ value = '', onChange }: { value?: string; onChange: (value: IOnChangeArgs) => void }) {
  const defaults = useMemo(() => (value ? parseConnectionString(value) : undefined), [value]);

  const [sourceType, setSourceType] = useState<string>(defaults?.type || 'webrtc');
  const [connectParams, setConnectParams] = useState<RtcConnectionParams | null>(null);

  function onSubmit(params: RtcConnectionParams, maxResolution: VideoDimensions) {
    setConnectParams(null);
    console.log('VideoSourceSelection onSubmit', params, maxResolution);
    onChange({ url: buildConnectionUrl(params), maxResolution });
  }

  function onConnect(params: RtcConnectionParams) {
    setConnectParams(params);
  }

  const urlDefaults = defaults?.type === 'url' ? defaults : { type: 'url' as const, url: '' };
  const webtorrentDefaults: WebtorrentConnectionParams =
    defaults?.type === 'webtorrent' ? defaults : { type: 'webtorrent' as const, share: '', pwd: '' };
  const webrtcDefaults: WebrtcConnectionParams = defaults?.type === 'webrtc' ? defaults : getStableWebrtcDefaults();
  const webcamDefaults: WebcamConnectionParams =
    defaults?.type === 'webcam' ? defaults : { type: 'webcam' as const, deviceId: '', idealWidth: 4096, idealHeight: 2160 };

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
          , but it requires running
          <a
            href="https://github.com/AlexxIT/go2rtc"
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-500 hover:underline mx-1">
            go2rtc
          </a>
          as a gateway, e.g. on a Raspberry&nbsp;Pi&nbsp;Zero.
        </p>
      </Hint>
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
        <ConnectDialog
          params={connectParams}
          onConfirm={maxResolution => onSubmit(connectParams, maxResolution)}
          onCancel={() => setConnectParams(null)}
        />
      )}
    </>
  );
}
