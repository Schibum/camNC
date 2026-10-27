# camNC desktop app

The camNC web app packaged with [Tauri 2](https://v2.tauri.app), for macOS and Windows. It bundles the built web app
(`apps/camNC/dist`), so it works offline, and adds what a browser cannot do:

- **IP cameras over RTSP.** A [go2rtc](https://github.com/AlexxIT/go2rtc) sidecar runs on `127.0.0.1` and serves the
  camera to the page over WebRTC. Pick _Network camera_ in the camera setup and enter the camera's `rtsp://` URL.
- **Machine control on any webview engine.** The FluidNC socket and file upload go through Rust
  (`tauri-plugin-websocket`, `tauri-plugin-http`), so no mixed-content blocking or local network permission applies.

The web code detects the app with `isDesktopApp()` (`apps/camNC/src/lib/desktop`). In the app there is no sign-in:
settings stay on this computer and are not synced.

## Develop

Needs Rust ([rustup](https://rustup.rs)) and the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/).

```sh
pnpm install
pnpm --filter @wbcnc/camnc-desktop desktop:dev    # vite dev server in the app window
pnpm --filter @wbcnc/camnc-desktop desktop:build  # installers in src-tauri/target/release/bundle
```

Both first download the pinned go2rtc release for this machine into `src-tauri/binaries/` (`scripts/fetch-go2rtc.mjs`).

## Security

- go2rtc's API listens on `127.0.0.1` only, on a random port, and only allows `/api/ws`. Streams come from its config
  file, which the app writes, so no other program or web page can add sources (e.g. `exec:`) through the API.
- Only RTSP/RTMP camera URLs are accepted. Adding a camera restarts go2rtc with the new config.
- The HTTP plugin may only reach private network addresses and `.local` names (`src-tauri/capabilities/default.json`).

## Releases

`.github/workflows/desktop.yml` builds a universal macOS app and a Windows installer on pull requests that touch the
app, and a draft GitHub release for a `desktop-v*` tag. Not set up yet: macOS signing and notarization, Windows signing,
and the updater (needs a signing key pair, `pnpm tauri signer generate`).

## Linux

The app builds on Linux, but Ubuntu's WebKitGTK is compiled without WebRTC, so the camera does not show there. Machine
control and the rest of the app work.
