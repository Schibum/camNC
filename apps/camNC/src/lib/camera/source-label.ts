import { parseConnectionString, RtcConnectionParams } from '@wbcnc/go2webrtc/url-helpers';

const kSourceLabels: Record<string, string> = {
  rtsp: 'network camera',
  go2rtc: 'go2rtc',
  webtorrent: 'go2rtc (webtorrent)',
  webrtc: 'phone',
  webcam: 'webcam',
  url: 'video URL',
};

function sourceType(url: string) {
  try {
    return parseConnectionString(url).type;
  } catch {
    return null;
  }
}

/** A short name for the kind of source a camera URL points to, e.g. "network camera" or "phone". */
export function cameraSourceLabel(url: string) {
  return kSourceLabels[sourceType(url) ?? ''] ?? 'camera';
}

/** Whether the camera is streamed straight from its RTSP URL (desktop app only). */
export function isDirectNetworkCamera(url: string) {
  return sourceType(url) === 'rtsp';
}

function hostOf(url: string) {
  try {
    return new URL(url).hostname || null;
  } catch {
    return null;
  }
}

/** A name for a new camera from its source, used unless the source knows better (e.g. the camera's model). */
export function suggestCameraName(params: RtcConnectionParams): string {
  switch (params.type) {
    case 'rtsp':
      return `Network camera ${hostOf(params.url) ?? ''}`.trim();
    case 'webcam':
      return 'Webcam';
    case 'webrtc':
      return 'Phone';
    case 'go2rtc':
      return params.src || 'go2rtc camera';
    case 'webtorrent':
      return 'go2rtc camera';
    case 'url':
      return hostOf(params.url) ?? 'Video';
  }
}

/** `name`, or `name 2`, `name 3`, … when another camera has it. */
export function uniqueCameraName(name: string, taken: string[]): string {
  if (!taken.includes(name)) return name;
  for (let i = 2; ; i++) {
    if (!taken.includes(`${name} ${i}`)) return `${name} ${i}`;
  }
}

/** Where a camera's video comes from, without the login, e.g. "192.168.1.5 · /h264Preview_01_main". */
export function cameraSourceDetail(url: string): string | null {
  try {
    const params = parseConnectionString(url);
    switch (params.type) {
      case 'rtsp': {
        const parsed = new URL(params.url);
        return [parsed.hostname, `${parsed.pathname}${parsed.search}`].filter(part => part && part !== '/').join(' · ');
      }
      case 'go2rtc':
        return `${params.src} on ${params.host}`;
      case 'url':
        return hostOf(params.url);
      default:
        return null;
    }
  } catch {
    return null;
  }
}
