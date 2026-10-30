import { invoke } from '@tauri-apps/api/core';
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { setRtspGateway } from '@wbcnc/go2webrtc/rtsp-gateway';
import { disposeIdleVideoSources } from '@wbcnc/go2webrtc/use-video-source';
import { setSignalWebSocket } from '@wbcnc/go2webrtc/trystero';
import { isDesktopApp } from './is-desktop';
import { TauriWebSocket } from './tauri-websocket';
import { watchForUpdates } from './updates';

export { isDesktopApp };

/** Transports for the machine controller that go through the app's Rust side instead of the webview's network stack. */
export const desktopMachineTransport = {
  WebSocket: TauriWebSocket as unknown as typeof WebSocket,
  fetch: tauriFetch as typeof fetch,
};

/** Hooks the page up to the desktop app's native side. Call once at startup. */
export function initDesktopApp() {
  if (!isDesktopApp()) return;
  // The phone camera's pairing server accepts only the web app's origins; the native socket sends none.
  setSignalWebSocket(TauriWebSocket as unknown as typeof WebSocket);
  watchForUpdates();
  let go2rtcHost: string | undefined;
  setRtspGateway(async url => {
    const stream = await invoke<{ host: string; src: string }>('go2rtc_stream', { url }).catch(err => {
      // Commands reject with the plain string the Rust side returned.
      throw err instanceof Error ? err : new Error(String(err));
    });
    // A new camera restarts go2rtc on another port, which ends the streams of cameras kept connected for a quick
    // switch back: those have to connect again.
    if (go2rtcHost && stream.host !== go2rtcHost) disposeIdleVideoSources(source => /^rtsps?:/i.test(source));
    go2rtcHost = stream.host;
    return stream;
  });
}
