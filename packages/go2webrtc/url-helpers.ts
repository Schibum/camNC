const rtcSchemas = ['webtorrent:', 'webrtc:', 'go2rtc:'] as const;
export type RtcSchema = (typeof rtcSchemas)[number];

export interface WebrtcConnectionParams {
  type: 'webrtc';
  accessToken: string;
}

export interface WebtorrentConnectionParams {
  type: 'webtorrent';
  share: string;
  pwd: string;
}

export interface UrlConnectionParams {
  type: 'url';
  url: string;
}

export interface WebcamConnectionParams {
  type: 'webcam';
  deviceId: string;
  idealWidth?: number;
  idealHeight?: number;
}

export interface Go2rtcConnectionParams {
  type: 'go2rtc';
  host: string;
  src: string;
}

export type RtcConnectionParams =
  | WebrtcConnectionParams
  | WebtorrentConnectionParams
  | UrlConnectionParams
  | WebcamConnectionParams
  | Go2rtcConnectionParams;

export function parseConnectionString(connectionString: string): RtcConnectionParams {
  const url = new URL(connectionString);
  let params = url.searchParams;
  switch (url.protocol) {
    case 'webrtc:': {
      const accessToken = params.get('accessToken');
      if (accessToken) {
        return { type: 'webrtc', accessToken };
      }
      throw new Error('missing accessToken');
    }
    case 'webtorrent:': {
      const share = params.get('share');
      const pwd = params.get('pwd');
      if (share && pwd) {
        return { type: 'webtorrent', share, pwd };
      }
      throw new Error('missing share or pwd');
    }
    case 'go2rtc:': {
      const host = params.get('host');
      const src = params.get('src');
      if (host && src) {
        return { type: 'go2rtc', host, src };
      }
      throw new Error('missing host or src');
    }
    case 'webcam:':
      const deviceId = params.get('deviceId');
      const width = params.get('width');
      const height = params.get('height');

      if (deviceId) {
        return {
          type: 'webcam',
          deviceId,
          idealWidth: width ? parseInt(width) : undefined,
          idealHeight: height ? parseInt(height) : undefined,
        };
      }
      throw new Error('missing deviceId');
    case 'https:':
    case 'http:':
      return { type: 'url', url: connectionString };
    default:
      throw new Error('unsupported protocol');
  }
}

export function buildConnectionUrl(params: RtcConnectionParams) {
  switch (params.type) {
    case 'webrtc':
      return buildWebrtcConnectionUrl(params);
    case 'webtorrent':
      return buildRtcConnectionUrl(params);
    case 'go2rtc':
      return buildGo2rtcConnectionUrl(params);
    case 'webcam':
      return buildWebcamConnectionUrl(params);
    case 'url':
      return params.url;
    default:
      throw new Error('unsupported connection type');
  }
}

function buildRtcConnectionUrl({ share, pwd, type }: WebtorrentConnectionParams) {
  const params = new URLSearchParams({ share, pwd });
  return `${type}:?${params.toString()}`;
}

function buildWebrtcConnectionUrl({ accessToken }: WebrtcConnectionParams) {
  const params = new URLSearchParams({ accessToken });
  return `webrtc:?${params.toString()}`;
}

function buildWebcamConnectionUrl({ deviceId, idealWidth, idealHeight }: WebcamConnectionParams) {
  let params = new URLSearchParams({
    deviceId,
    ...(idealWidth ? { width: idealWidth.toString() } : {}),
    ...(idealHeight ? { height: idealHeight.toString() } : {}),
  });
  return `webcam:?${params.toString()}`;
}

function buildGo2rtcConnectionUrl({ host, src }: Go2rtcConnectionParams) {
  const params = new URLSearchParams({ host, src });
  return `go2rtc:?${params.toString()}`;
}

export function genRandomWebtorrent() {
  const share = generatePassword(16);
  const pwd = generatePassword(16);
  return buildRtcConnectionUrl({ share, pwd, type: 'webtorrent' });
}

export function genRandomWebrtc() {
  const accessToken = generatePassword(16);
  return buildWebrtcConnectionUrl({ type: 'webrtc', accessToken });
}

export function generatePassword(length: number = 16) {
  const characterSet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_~';
  const randomValues = new Uint8Array(length);
  crypto.getRandomValues(randomValues);
  return Array.from(randomValues)
    .map(byte => characterSet[byte % characterSet.length])
    .join('');
}
