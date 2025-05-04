import { AtomsHydrator } from '@/lib/AtomsHydrator';
import {
  genRandomWebrtc,
  parseConnectionString,
  RtcConnectionParams,
  WebcamConnectionParams,
  WebrtcConnectionParams,
  WebtorrentConnectionParams,
} from '@wbcnc/go2webrtc/url-helpers';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@wbcnc/ui/components/tabs';
import { atom, Provider, useAtom, useAtomValue } from 'jotai';
import { useState } from 'react';

import { ConnectDialog } from './ConnectDialog';
import { Go2RtcTab } from './Go2RtcTab';
import { PhoneTab } from './PhoneTab';
import { UrlTab } from './UrlTab';
import { WebcamTab } from './WebcamTab';

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
