import type { Go2rtcConnectionParams } from './url-helpers';

/** Turns a camera's RTSP URL into a go2rtc stream the page can play over WebRTC. */
export type RtspGateway = (url: string) => Promise<Omit<Go2rtcConnectionParams, 'type'>>;

let gateway: RtspGateway | null = null;

/** Set by the desktop app, which runs go2rtc next to the page. Browsers cannot open RTSP connections. */
export function setRtspGateway(value: RtspGateway | null) {
  gateway = value;
}

export function getRtspGateway(): RtspGateway {
  if (!gateway) throw new Error('RTSP cameras need the camNC desktop app');
  return gateway;
}
