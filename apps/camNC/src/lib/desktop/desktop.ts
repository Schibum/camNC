import { invoke } from '@tauri-apps/api/core';
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { setRtspGateway } from '@wbcnc/go2webrtc/rtsp-gateway';
import { isDesktopApp } from './is-desktop';
import { TauriWebSocket } from './tauri-websocket';

export { isDesktopApp };

/** Transports for the machine controller that go through the app's Rust side instead of the webview's network stack. */
export const desktopMachineTransport = {
  WebSocket: TauriWebSocket as unknown as typeof WebSocket,
  fetch: tauriFetch as typeof fetch,
};

/** Hooks the page up to the desktop app's native side. Call once at startup. */
export function initDesktopApp() {
  if (!isDesktopApp()) return;
  setRtspGateway(url =>
    invoke<{ host: string; src: string }>('go2rtc_stream', { url }).catch(err => {
      // Commands reject with the plain string the Rust side returned.
      throw err instanceof Error ? err : new Error(String(err));
    })
  );
}
