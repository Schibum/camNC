# camNC desktop app

The camNC web app packaged with [Tauri 3](https://v3.tauri.app) (alpha) and its [CEF runtime](https://v3.tauri.app/develop/cef/),
for macOS and Windows. The app ships its own Chromium, so it behaves like camNC in Chrome on every platform (WebRTC, WebGPU,
cross-origin isolation for OpenCV's threads). It bundles the built web app (`apps/camNC/dist`), so it works offline, and
adds what a browser cannot do:

- **IP cameras over RTSP.** A [go2rtc](https://github.com/AlexxIT/go2rtc) sidecar runs on `127.0.0.1` and serves the
  camera to the page over WebRTC. Pick _Network camera_ in the camera setup and enter the camera's `rtsp://` URL.
- **Machine control without browser restrictions.** The FluidNC socket and file upload go through Rust
  (`tauri-plugin-websocket`, `tauri-plugin-http`), so no mixed-content blocking or local network permission applies.

The web code detects the app with `isDesktopApp()` (`apps/camNC/src/lib/desktop`). In the app there is no sign-in:
settings stay on this computer and are not synced.

## Develop

Needs Rust ([rustup](https://rustup.rs)), the [Tauri prerequisites](https://v3.tauri.app/start/prerequisites/), and CMake
and Ninja on macOS and Windows (`brew install cmake ninja`). The first build downloads the CEF binary distribution
(~1 GB) into the user cache (`~/Library/Caches/tauri-cef` on macOS).

```sh
pnpm install
pnpm --filter @wbcnc/camnc-desktop desktop:dev    # vite dev server in the app window
pnpm --filter @wbcnc/camnc-desktop desktop:build  # installers in src-tauri/target/release/bundle
```

Both first download the pinned go2rtc release for this machine into `src-tauri/binaries/` (`scripts/fetch-go2rtc.mjs`).
On macOS, CEF only runs from an `.app` bundle, so `desktop:dev` bundles before launching and starts slower than a web
dev server.

### Debugging

Right-click → Inspect, or F12, opens Chrome DevTools in debug builds. Debug builds also expose the Chrome DevTools
Protocol on `127.0.0.1:9222`, so Playwright can drive the running app like a browser:

```ts
const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
const page = browser.contexts()[0].pages()[0];
```

## Security

- go2rtc's API listens on `127.0.0.1` only, on a random port, and only allows `/api/ws`. Streams come from its config
  file, which the app writes, so no other program or web page can add sources (e.g. `exec:`) through the API.
- Only RTSP/RTMP camera URLs are accepted. Adding a camera restarts go2rtc with the new config.
- The HTTP plugin may only reach private network addresses and LAN names (`.local`, `.lan`, `.home`, `.fritz.box`, …) (`src-tauri/capabilities/default.json`).

## Releases and updates

`.github/workflows/desktop.yml` builds macOS (Apple silicon, `.dmg`), Windows (NSIS installer) and Linux (`.deb`):

- Pull requests that touch the app get the bundles as build artifacts.
- Every push to `main` that touches the app or the web app is released as `desktop-v0.1.<run number>`, marked as the
  latest release. The rolling `desktop-latest` release holds the `latest.json` that installed apps check.
- Release builds check for an update 10 seconds after start and then every 4 hours. A newer version is downloaded in the
  background and the app offers a restart; it never restarts on its own, so a running job is not interrupted. On Windows
  the installer runs at that restart.
- Linux does not update itself yet: the updater only replaces AppImages, and the AppImage step of the Tauri 3 alpha hung
  in CI. Install a newer `.deb` from the releases instead.

Updates are signed with a minisign key pair (`pnpm tauri signer generate`). The public key is in `tauri.conf.json`
(`plugins.updater.pubkey`), and the private key goes into the `TAURI_SIGNING_PRIVATE_KEY` repository secret. Without the
secret, main builds but nothing is released. Development builds never update.

Not set up yet: macOS signing with a Developer ID and notarization, and Windows code signing. macOS builds are signed ad
hoc, so the first start of a downloaded app needs right-click → Open (or `xattr -dr com.apple.quarantine camNC.app`);
updates afterwards install without that. Windows shows a SmartScreen warning on first install.

## Linux

Builds with GTK 4 (`libgtk-4-dev`) on Ubuntu 24.04 or newer.

CEF 154 no longer ships `libEGL` and `libGLESv2`, which the Linux and Windows bundlers of the Tauri alpha still copy.
CI runs `scripts/cef-bundle-files.mjs` before bundling, which puts the system's GL libraries there on Linux (needs
`libegl1` and `libgles2`) and empty placeholders on Windows.
