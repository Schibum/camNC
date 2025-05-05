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
