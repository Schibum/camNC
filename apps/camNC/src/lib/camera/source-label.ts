import { parseConnectionString } from '@wbcnc/go2webrtc/url-helpers';

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
