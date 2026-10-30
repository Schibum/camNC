import { invoke } from '@tauri-apps/api/core';

/** An IP camera the desktop app found on the local network. */
export interface FoundCamera {
  host: string;
  /** From ONVIF, e.g. "Reolink". */
  name?: string | null;
  /** From ONVIF, e.g. "E1 Zoom". */
  hardware?: string | null;
  /** ONVIF device service URL, if the camera answered ONVIF discovery. */
  onvifUrl?: string | null;
  /** Whether the RTSP port (554) is open. */
  rtsp: boolean;
}

/** A stream an ONVIF camera offers; `url` includes the login. */
export interface CameraStream {
  name: string;
  url: string;
  width?: number | null;
  height?: number | null;
}

function asError(err: unknown) {
  // Commands reject with the plain string the Rust side returned.
  return err instanceof Error ? err : new Error(String(err));
}

/** Looks for cameras with ONVIF discovery and a scan of the local network for the RTSP port. Takes a few seconds. */
export async function discoverCameras(): Promise<FoundCamera[]> {
  return invoke<FoundCamera[]>('discover_cameras').catch(err => {
    throw asError(err);
  });
}

/** Logs in to an ONVIF camera and returns its streams, largest first. One login attempt per call. */
export async function onvifStreams(onvifUrl: string, user: string, password: string): Promise<CameraStream[]> {
  return invoke<CameraStream[]>('onvif_streams', { onvifUrl, user, password }).catch(err => {
    throw asError(err);
  });
}

export function cameraLabel(camera: FoundCamera) {
  const name = [camera.name, camera.hardware].filter(Boolean).join(' ');
  return name || 'Camera';
}

/** RTSP paths of common cameras, for cameras without ONVIF. */
export const kRtspPresets = [
  { label: 'Reolink, main stream (H.264)', path: '/h264Preview_01_main' },
  { label: 'Reolink, main stream (H.265 models)', path: '/h265Preview_01_main' },
  { label: 'Reolink, sub stream', path: '/h264Preview_01_sub' },
  { label: 'Hikvision', path: '/Streaming/Channels/101' },
  { label: 'Dahua / Amcrest', path: '/cam/realmonitor?channel=1&subtype=0' },
  { label: 'TP-Link Tapo', path: '/stream1' },
] as const;

/** An RTSP URL with the login percent-encoded, so passwords with special characters work. */
export function buildRtspUrl(host: string, user: string, password: string, path: string, port = 554) {
  const login = user ? `${encodeURIComponent(user)}${password ? `:${encodeURIComponent(password)}` : ''}@` : '';
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `rtsp://${login}${host}${port === 554 ? ':554' : `:${port}`}${normalizedPath}`;
}
