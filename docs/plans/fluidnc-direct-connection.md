# Plan: built-in machine control and a direct FluidNC connection

Status: proposal (October 2026). Nothing here is implemented yet.

## Goal

Make camNC the only tool needed at the machine. Users should be able to
connect, home, jog, zero, upload and run jobs, watch the console and handle
alarms from camNC, without keeping the FluidNC WebUI v3 open with the camNC
extension loaded.

There are two separate problems:

1. **Transport.** How the browser tab at `https://run.camnc.app` reaches an
   ESP32 that only speaks plain HTTP/WebSocket on the LAN (or USB serial).
2. **Feature surface.** Which WebUI features to rebuild inside camNC, on top of
   a protocol layer that doesn't depend on the transport.

Most of the risk is in (1), so most of this document covers it.

## Where we are today

- `apps/fluidnc-integration` runs as a WebUI v3 _extension_ (an iframe inside
  the WebUI). It talks to the WebUI over `postMessage` (`FluidncApi`) and
  exposes that API to camNC over a WebRTC data channel with Firebase
  signalling (`FluidncServer` and `FluidncClient` in `packages/fluidnc-api`).
- `apps/camNC/src/lib/fluidnc/cnc-api.ts` (`CncApi`) is built on that RPC. It
  calls `cmd()` (`?`, `$G`, `$#`, `G10 L2`, `G53 G0`, `$SD/Run`), `upload()` and
  `download('/config.yaml')`, and parses the `stream` events (status,
  offsets, modals).
- Downsides:
  - The WebUI tab must stay open.
  - It depends on Firebase and internet access. The README says FluidNC must
    run in STA mode.
  - Three hops: camNC → WebRTC → extension → postMessage → WebUI → HTTP/WS →
    ESP32.
  - Status comes from polling `?` every 3 s while idle.
  - Commands get no `ok`/`error` correlation.

The good news is that `CncApi` is already the only consumer. Its callers are
`2DView`, `FluidncButton`, `UploadMenuItem`, `MachinePositionMarker`,
`MachineZeroAxes`, `useInitToolpathOffset` and `fluidnc-settings`. That makes
it the natural place to swap the transport underneath.

## What the firmware actually exposes

Checked against `bdring/FluidNC` source: tag `v4.1.1` (2026-09-23) and `main`
at `6735500` (2026-10-21).

| Thing           | FluidNC 4.x                                                                                                                                                                                                                                                       | Notes                                                                                                                                                                                                      |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| WebSocket       | `AsyncWebSocket("/")` on the **HTTP port (80)**.                                                                                                                                                                                                                  | FluidNC 3.x used HTTP port + 1 (**81**), see [bdring/FluidNC#138](https://github.com/bdring/fluidnc/issues/138). Probe both.                                                                               |
| WS framing      | Text frames from the client are pushed into the channel's input exactly like serial bytes, so G-code, `$` commands and realtime chars (`?`, `!`, `~`, `0x18`, `0x85` jog cancel) all work. Output comes back as **binary** frames, coalesced to about 1400 bytes. | On connect the server sends `currentID:<n>` (v3) and `CURRENT_ID:<n>` (v2). The client sends `PING:` for keepalive and gets `PING:60000:60000` back.                                                       |
| WS sessions     | The session comes from the `sessionId` cookie. **The newest socket for a session closes the older ones.**                                                                                                                                                         | A cross-origin page has no cookie, so every camNC tab would share session `""` and kick the others off. Connect with `?independent_session` (supported in 4.1.1) to get a session per client.              |
| WS client limit | `WEBUI_MAX_WS_CLIENTS = 4`                                                                                                                                                                                                                                        | The WebUI plus camNC fits.                                                                                                                                                                                 |
| Auto-report     | `$Report/Interval=<ms>` (per channel, `WSChannel::autoReport`)                                                                                                                                                                                                    | Replaces our `?` polling. Status includes `Ov:`, `FS:`, `WCO:`, `SD:` (job progress).                                                                                                                      |
| Config          | `$Config/Dump` (`$CD`)                                                                                                                                                                                                                                            | Returns the YAML over the stream, so no HTTP download of `config.yaml` is needed.                                                                                                                          |
| Files           | `$SD/ListJSON`, `$LocalFS/ListJSON`, `$Files/ListGCode`, `$SD/Run`, `$SD/Delete`, `$SD/Rename`, `$SD/Mkdir`, `$File/ShowSome`                                                                                                                                     | All work over the stream.                                                                                                                                                                                  |
| Upload          | HTTP `POST /upload` (SD) and `POST /files` (LocalFS), multipart. `$Xmodem/Receive=<path>` on any channel. WebDAV at `/sd` and `/flash`.                                                                                                                           | XMODEM also works over serial and over the WS channel, which pushes binary frames into the input.                                                                                                          |
| HTTP commands   | `GET /command?cmd=…&PAGEID=<ws id>` sends its output to that WebSocket.                                                                                                                                                                                           |                                                                                                                                                                                                            |
| **CORS**        | **No `Access-Control-Allow-*` headers anywhere** (grep of `src/WebUI`).                                                                                                                                                                                           | Cross-origin `fetch` can _send_ requests (`no-cors`; a multipart POST is a "simple" request) but can't read the responses. WebSockets aren't subject to CORS, and `AsyncWebSocket` doesn't check `Origin`. |
| Multiple UIs    | `main` only (unreleased): `HTTP/UIDir` (default `/sd/ui`) serves `/ui/<name>/`, and `HTTP/DefaultUI` picks which one `/` serves.                                                                                                                                  | Lets us ship a small camNC page **on the device** next to the stock WebUI (see Option B).                                                                                                                  |
| Simulators      | `env:linux`/`env:macos` builds the real WebUI server on `PosixAsyncTCP`. `env:wasm` is an in-browser simulator including the WebUI server (`FluidNC/wasm/demo`).                                                                                                  | Use these for integration tests and for a "demo machine" mode.                                                                                                                                             |
| Bluetooth       | `env:bt` is Bluetooth Classic SPP, not BLE.                                                                                                                                                                                                                       | Web Bluetooth (BLE GATT only) can't use it. Desktop Chrome's Web Serial can open RFCOMM ports.                                                                                                             |

## How the browser can reach the controller

camNC has to stay a **secure context**. `https://run.camnc.app` needs it for
WebGPU (hide-machine), WebCodecs and `MediaStreamTrackProcessor`,
`getUserMedia` (webcam), service workers and Clerk. That rules out serving the
real camNC app from `http://<esp32>/`.

### Option A: direct WebSocket from the HTTPS page via Chrome Local Network Access (recommended primary)

Chrome's Local Network Access (LNA) replaced Private Network Access.

- Since **Chrome 142**, `fetch`, subresource loads and subframe navigations to
  private addresses trigger a one-time permission prompt.
- Since **Chrome 147**, LNA also covers **WebSocket and WebTransport**.
- **Once the user grants the permission, mixed-content blocking is relaxed for
  those requests.** The browser has to know the target is local _before_ DNS
  resolution. That means a private IP literal (`ws://192.168.1.50/`) or a
  `.local` name (`ws://fluidnc.local/`) qualifies. A public hostname that
  happens to resolve to a LAN address doesn't, unless `fetch` is called with
  `targetAddressSpace: 'local'`. There is no WebSocket equivalent of that
  option yet.
- The permission is only available in secure contexts, which camNC is.
- Chrome 145 split the permission into `local-network` and `loopback-network`.

Sources: [Chrome blog](https://developer.chrome.com/blog/local-network-access),
[LNA explainer](https://github.com/WICG/local-network-access/blob/main/explainer.md),
[WebSocket intent to ship](https://groups.google.com/a/chromium.org/g/blink-dev/c/O6GMKt44Ups),
[explainer issue #16 (WebSocket use case)](https://github.com/explainers-by-googlers/local-network-access/issues/16),
[GoogleChrome/modern-web-guidance-src#1127 (version timeline)](https://github.com/GoogleChrome/modern-web-guidance-src/issues/1127).

What this gets us with **stock firmware** (4.x):

- `new WebSocket('ws://<ip>/?independent_session')` gives a full-duplex
  serial-like channel. Commands, realtime chars, auto-report status,
  `$Config/Dump`, file listing and `$SD/Run` all work without HTTP.
- **Uploads.**
  - (a) `fetch('http://<ip>/upload', { method: 'POST', mode: 'no-cors', body: formData })`.
    It's fire-and-forget because the response is opaque. Verify afterwards
    with `$SD/ListJSON` (size check). We get no upload progress.
  - (b) XMODEM over the WebSocket (`$Xmodem/Receive=/sd/<file>`, then send
    128/1K blocks as binary frames). This gives progress and verification but
    needs a careful implementation and is slower.
  - Start with (a) and add (b) if (a) proves unreliable.
- **Upstream improvement worth a PR:** an opt-in `HTTP/CORSOrigin` setting
  (e.g. `https://run.camnc.app`) that adds `Access-Control-Allow-Origin` and
  handles `OPTIONS`. That makes uploads with progress and `/command`
  responses readable. It's small and self-contained, so it has a decent
  chance of being merged. Until it lands, we can ship it in a camNC build of
  FluidNC.

Limits:

- **Chrome/Edge only, version 147 or later.** Firefox and Safari still block
  `ws://` from HTTPS pages (only `localhost` is exempt), so they need Option B
  or C.
- `.local` resolution is unreliable on Android and in some Windows setups.
  Default to the IP address and show the one FluidNC reports.
- If WebUI authentication is enabled on the device, the third-party cookie
  from `/login` won't be sent cross-site. This is uncommon on hobby machines.
  Document it, and fall back to Option B.
- It only works when the browser is on the same LAN, so no remote access.
  That's the same as today in practice.

### Option B: a small bridge page served by the controller and opened as a popup (universal fallback; replaces the extension)

Ship a single-file `camnc-bridge.html.gz` (a few KB, no framework). The user
uploads it once to the SD card (`/sd/ui/camnc/index.html.gz` with UIDir on
newer firmware, or any path on older firmware). camNC opens it with
`window.open('http://<ip>/ui/camnc/')`. A top-level navigation from HTTPS to
HTTP isn't mixed content. The bridge is **same-origin with FluidNC**, so it
has unrestricted HTTP (with upload progress), WebSocket and cookie/auth
access. It relays everything to `window.opener` over `postMessage`, with
strict `origin` checks on both sides. Comlink works over a `Window` endpoint,
so `FluidncApi` can be reused almost unchanged.

- Works in **all** browsers, including Safari and iOS, and with any firmware
  version.
- No Firebase and no internet needed beyond loading camNC itself.
- Downsides: a second window must stay open, and it's one more thing to
  install on the device. This is the same trade-off as the extension today,
  minus the full WebUI.

The existing WebUI extension (`apps/fluidnc-integration`) can stay as a third
fallback for users who already run it.

### Option C: Web Serial over USB (offline / AP mode, desktop only)

`navigator.serial` in Chrome and Edge **desktop** (still not shipped on
Android). Open the ESP32's USB-UART at 115200 baud. It needs no network and
works when FluidNC runs in AP mode or has Wi-Fi disabled. The same line
protocol works. Uploads go over `$Xmodem/Receive`, or as G-code streamed line
by line with the character-counting protocol. Desktop Web Serial can also
open Bluetooth SPP ports, which covers `env:bt` builds.

Sources: [Web Serial RFCOMM intent to ship](https://groups.google.com/a/chromium.org/g/blink-dev/c/P4YwDCcvdvs/m/CHbyTu_gAAAJ).

### Option D: headless bridge on the camera host (remote access, later)

Many users already run go2rtc on a Raspberry Pi or a PC for IP cameras. A
small Node or Go service could:

1. connect to FluidNC over WebSocket (or Telnet on 23), and
2. expose a WebRTC data channel using our existing `RolePeering` and
   Firebase signalling, speaking the same line protocol.

This is the current architecture minus the WebUI tab, and it works across
NATs. Pion (Go) or node-datachannel would do. Do this only if there's demand
for remote monitoring.

### Rejected or deferred

- **Serving the real camNC app from the ESP32.** It wouldn't be a secure
  context, so WebGPU, WebCodecs, `getUserMedia` and Clerk would be lost. The
  bundle (OpenCV WASM, models) also doesn't fit in flash. A small loader on
  the device that pulls camNC from a CDN has the same insecure-context
  problem.
- **HTTPS on the ESP32.** Needs certificates the browser trusts for a LAN
  device (a Plex-style per-device certificate under a domain we own, with DNS
  pointing at the private IP). That means certificate issuance and renewal
  infrastructure, plus about 40 KB+ RAM per TLS session on a heap that
  FluidNC already works hard to keep unfragmented (see `WSChannel.h`). That's
  too heavy for the benefit now that LNA exists.
- **WebRTC data channel in the firmware** (e.g. Espressif `esp_peer` or
  libpeer). This is the most elegant option (no tab, works remotely) but needs
  DTLS+SCTP RAM that realistically means an ESP32-S3 with PSRAM, and a
  long-lived firmware fork. Spike only if Option D proves the demand.
- **Web Bluetooth.** FluidNC uses Classic SPP, not BLE.

### Recommendation

Build a transport abstraction and ship transports in this order:

1. **A (direct WS)**, the default on Chrome/Edge 147+.
2. **B (bridge popup)**, the fallback for Safari, Firefox, auth-enabled
   devices and old Chrome.
3. **Existing extension over WebRTC**, kept unchanged.
4. **C (Web Serial)**.
5. **D (headless bridge)**, only on demand.

Detect capabilities at connect time:

- Try A first.
- On a `SecurityError` or a WebSocket close before open, offer B.
- If `'serial' in navigator`, offer C as well.

## Architecture changes

### 1. `packages/fluidnc-api`: transport and protocol layers

```
          ┌──────────────── camNC UI (DRO, jog, console, files, job) ─────────────┐
          │                         CncApi (signals)                              │
          └───────────────────────────────┬───────────────────────────────────────┘
                                          │
                         FluidncProtocol (transport-agnostic)
          line splitting · ok/error correlation · status/offset/modal/alarm parsing
          auto-report · realtime cmds · command queue · file ops · upload strategy
                                          │
          ┌──────────────┬────────────────┼─────────────────┬────────────────────┐
     WsTransport    BridgeTransport   ExtensionTransport  SerialTransport   (RtcBridgeTransport)
     (Option A)     (Option B)        (today's WebRTC)    (Option C)        (Option D)
```

```ts
interface CncTransport {
  readonly kind: 'ws' | 'bridge' | 'extension' | 'serial' | 'rtc-bridge';
  readonly state: Signal<'connecting' | 'open' | 'closed' | 'error'>;
  open(): Promise<void>;
  close(): Promise<void>;
  /** Raw bytes/text towards the controller (lines must include '\n'). */
  write(data: string | Uint8Array): void;
  /** Single realtime byte (?, !, ~, 0x18, 0x85, override bytes). */
  realtime(byte: number): void;
  /** Raw output chunks; the protocol layer does line splitting. */
  onData(cb: (chunk: string) => void): () => void;
  /** Optional fast paths; protocol falls back to XMODEM/line streaming. */
  upload?(path: string, file: Blob, onProgress?: (p: number) => void): Promise<void>;
  httpGet?(path: string): Promise<string>;
}
```

- `FluidncProtocol` owns a command queue. FluidNC answers each line with
  exactly one `ok` or `error:N`, in order. That lets `send(cmd)` resolve with
  the response lines collected between sending and the `ok`. This is the main
  correctness gain over today's fire-and-forget `cmd()`.
- Unsolicited lines go to typed events:
  - `<…>` for status
  - `[MSG:…]`
  - `[GC:…]`
  - `[G54:…]`
  - `ALARM:n`
  - `[PRB:…]`
  - `Grbl …` / `FluidNC …` banners after a reset, which must clear the queue
- Move the parsers in `apps/camNC/src/lib/fluidnc/fluidnc-stream-parser.ts`
  and `fluidnc-axis-bounds.ts` (and their tests) into this package. Add
  parsers for `Ov:`, `FS:`, `Pn:`, `SD:`, `Bf:`, alarm and error code tables,
  and `$SD/ListJSON`.
- Once connected, send `$Report/Interval=200`. Drop the `?` polling in
  `CncApi` and keep a slow `?` only as a fallback when no report has arrived
  for N seconds. Poll `$G` and `$#` only after commands that can change them,
  and on connect.
- Read `config.yaml` with `$Config/Dump` instead of `download()`. That works
  on every transport.
- `ExtensionTransport` wraps today's `FluidncClient`. The extension already
  forwards raw `stream` content and `cmd()` lines, so it maps directly.
  Uploads go through `api.upload`.

### 2. `CncApi` and connection settings in camNC

- Store: replace the single `fluidncToken` with a connection profile:
  - `{ kind, host?, wsPort?, token?, serialFilter? }`
  - keep `token` for the extension path
  - add a migration for existing persisted state (superjson storage in
    `store-storage.ts`)
- `fluidnc-singleton.ts` builds the transport from the profile. `CncApi`
  takes a `FluidncProtocol` instead of `FluidncClient`. Its public signals
  (`status`, `machinePos`, `currentZero`, …) stay the same, so the callers
  don't change.
- Rework the `setup/fluidnc` route into a connection wizard:
  - enter an IP or `fluidnc.local`
  - "Connect", which triggers the LNA prompt
  - on failure, explain and offer to download or open the bridge page
  - otherwise "Use USB" or "Use WebUI extension"
  - remember the choice per machine

### 3. Bridge page (`apps/fluidnc-bridge`, new)

- A Vite single-file build (`vite-plugin-singlefile`, already referenced but commented
  out in camNC's Vite config), gzipped, plain TS, under 20 KB.
- It opens `ws://location.host/` and forwards `postMessage` to
  `window.opener`. The bridge accepts only an allow-listed camNC origin, and
  camNC accepts only `http://<configured host>`.
- It exposes `upload` (XHR with progress, `/upload` or `/files`) and
  `httpGet`.
- camNC shows "Download bridge page" and instructions for
  `HTTP/UIDir`/`/sd/ui/camnc/`. On firmware that has WebUI upload, it could
  also upload the file itself through the WebUI extension path.
- It shows a tiny "camNC bridge connected — keep this window open" status.
- It can replace `apps/fluidnc-integration` over time.

### 4. Optional firmware PR (upstream first, fork only if rejected)

- `HTTP/CORSOrigin` string setting. When set, add
  `Access-Control-Allow-Origin: <value>`,
  `Access-Control-Allow-Credentials` and
  `Access-Control-Allow-Private-Network: true`, and answer `OPTIONS`
  preflights on `/command`, `/upload`, `/files`. That's about 50 lines in
  `WebUIServer.cpp`.
- Optionally a `?origin` check on the WebSocket upgrade, so the setting also
  acts as an allow-list. Today any site can open a WebSocket to the machine
  once LNA is granted. That's worth calling out to FluidNC maintainers as a
  general safety improvement.

## The feature surface ("WebUI inside camNC")

Build the camera-centric parts first. The WebUI stays available for firmware
administration.

**MVP (needed to drop the WebUI for day-to-day use)**

- Connection indicator and connect/disconnect. Show the machine state badge
  (Idle/Run/Hold/Jog/Alarm/Door/Home) in the toolbar.
- DRO: MPos/WPos toggle, active WCS, feed/spindle (`FS:`), overrides (`Ov:`),
  limit pins (`Pn:`).
- Always-visible **Feed hold / Resume / Soft reset** (`!`, `~`, `0x18`). Also
  `$X` unlock and `$H` home (with per-axis variants).
- Jog panel: step sizes, XY/Z buttons, keyboard jog using `$J=G91 …` with
  `0x85` cancel on key-up. Keep the existing click-to-move on the camera view.
  Disable jogging unless the state is Idle or Jog.
- Zeroing: the existing camera-based XY zero plus Z zero, "zero all" and WCS
  select (G54–G59).
- Job:
  - upload the current G-code (existing flow), then run with confirmation
  - progress from `SD:` in the status report, overlaid on the toolpath (we
    already draw it)
  - pause, resume and stop
  - elapsed and ETA
- Console: scroll-back, filtering of status noise, command input with history,
  colour-coded `error:N`/`ALARM:N` with human-readable text.
- Alarm and error toasts with recovery hints.

**Phase 2**

- File manager for SD and LocalFS: list, upload, delete, rename, run, preview
  (`$File/ShowSome`) and load into the camNC toolpath view.
- Macros: user-defined buttons, stored in camNC settings and synced per user.
- Probing helpers (Z touch plate with `G38.2`, parse `[PRB:]`) with camera
  context.
- Override sliders (feed/rapid/spindle realtime bytes `0x90`–`0x9D`).

**Phase 3 / leave to the WebUI**

- `$` settings editor and `config.yaml` editor (read-only view first, via
  `$CD`).
- Firmware OTA (`/updatefw`), Wi-Fi setup and WebDAV. We would only link out
  to the WebUI for these.

UI placement: a collapsible right-hand "Machine" panel in `visualize/2DView`
(DRO, jog, job), with the console in a bottom drawer. Use `packages/ui`
components. A mobile layout is needed because phones and tablets at the
machine are a common use case.

## Safety requirements (non-negotiable)

- Never queue motion commands while the transport is down. Commands fail fast
  when disconnected, and nothing is re-sent automatically after a reconnect.
- Feed hold and soft reset bypass the command queue (realtime byte) and stay
  enabled whenever connected.
- Confirm before `$SD/Run`. Show the file name, bounds and the warnings
  `gcodeChecks.ts` already computes.
- Treat a banner after reset (`Grbl …`/`FluidNC …`) and `ALARM:` as queue
  flushes. Reject pending promises.
- Optionally make one camNC tab the "controller" (BroadcastChannel lock) so
  two tabs don't stream to the same machine.

## Testing strategy

- Unit tests (Vitest browser mode, like today):
  - protocol parsing and the ok/error correlation queue, against a
    `FakeTransport` that replays recorded transcripts (capture real sessions
    into `packages/fluidnc-api/test-data/`)
  - XMODEM framing
  - bridge `postMessage` origin checks
- Integration tests against real firmware without hardware:
  - Build FluidNC `env:linux` in CI, as a cached artifact keyed by FluidNC tag
    or commit.
  - Start it with a test `config.yaml`, and point `WsTransport` at
    `ws://127.0.0.1:<port>/?independent_session`.
  - Cover connect, auto-report, jog, `G10`, `$CD` bounds, upload + `$SD/Run`,
    feed hold, and reset mid-job.
  - Chromium in Vitest treats loopback as exempt, so this runs without the LNA
    prompt. Grant `local-network`/`loopback-network` via Playwright
    permissions if needed.
- **Demo mode:** load the FluidNC `env:wasm` simulator (it includes the real
  WebUI server on a JS-driven TCP shim) inside camNC to get a "virtual
  machine" for the website and onboarding. Needs COOP/COEP headers for
  `SharedArrayBuffer`. That's a stretch goal and must not break camNC's
  existing cross-origin resources (go2rtc and camera streams).
- Manual matrix: Chrome desktop / Chrome Android / Safari iOS / Firefox ×
  FluidNC 3.x (port 81) / 4.1.x / main, Wi-Fi STA and AP mode, and USB.

## Phased delivery

| Phase | Scope                                                                                                                                                                                                                   | Rough size |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| 0     | Spike: from `run.camnc.app` on Chrome 147+, open `ws://<ip>/?independent_session` to a real FluidNC 4.1, plus a `no-cors` upload. Confirm the LNA prompt, auto-report, `$CD` and uploads. Check `ws://<ip>:81/` on 3.x. | 1–2 days   |
| 1     | `CncTransport`, `FluidncProtocol` and parsers moved into `packages/fluidnc-api`. `ExtensionTransport` with **no behaviour change**. `CncApi` on top. Tests on recorded transcripts.                                     | ~1 week    |
| 2     | `WsTransport` and the connection wizard with profile migration. `$Report/Interval`. `$CD` bounds. CI job with FluidNC `env:linux`.                                                                                      | ~1 week    |
| 3     | MVP machine panel: DRO, realtime buttons, jog, zero, job run and progress, console, alarms.                                                                                                                             | 2–3 weeks  |
| 4     | Bridge page (`apps/fluidnc-bridge`) and `BridgeTransport`. Safari/Firefox path. Docs.                                                                                                                                   | ~1 week    |
| 5     | `SerialTransport` (Web Serial + XMODEM). File manager, macros, overrides.                                                                                                                                               | 1–2 weeks  |
| 6     | Upstream CORS / WebSocket origin PR to FluidNC. Optional WASM demo machine. Optional headless WebRTC bridge (Option D).                                                                                                 | open-ended |

Phase 0 is the go/no-go gate. If the LNA WebSocket path doesn't behave as
documented on real hardware, swap the order of phases 2 and 4 so the bridge
popup becomes the primary path.

## Open questions

- Which FluidNC versions do our users run? 3.x needs port 81 and may differ in
  framing. Do we support it or require 4.x?
- How common is WebUI authentication on hobby machines, and does it decide
  between Option A and Option B?
- Is it OK to depend on users copying a file to the SD card (Option B), or
  should the bridge also be installable from camNC through the WebUI
  extension in one click?
- Should camNC keep the WebRTC extension path once Options A and B exist, or
  deprecate it?
