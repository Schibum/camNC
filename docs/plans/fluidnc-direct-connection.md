# Plan: built-in machine control over a direct FluidNC WebSocket

Status: decided direction, not implemented (October 2026).

## Decisions

- **Greenfield.** camNC talks to FluidNC directly over a WebSocket from
  `https://run.camnc.app`. The WebUI extension, the WebRTC/Firebase relay for
  FluidNC and the `postMessage` API wrapper are removed. Nothing is kept for
  backwards compatibility.
- **Chrome/Edge only** (version 147 or later) for the machine connection. In
  other browsers, camNC still works as a viewer with the machine features
  hidden.
- **Reference hardware:** V1 Engineering Jackpot2 (ESP32) on an MPCNC LowRider
  V4, using
  [`FluidNC_Configs/LowRider CNC/Jackpot2/JP2_LR`](https://github.com/V1EngineeringInc/FluidNC_Configs/tree/main/LowRider%20CNC/Jackpot2/JP2_LR).
- **Supported firmware:** FluidNC **3.9.9** (the version V1 validates) and
  **4.1.x**. The connection code detects which one it's talking to.

## Firmware version for the Jackpot2

- V1 Engineering's Jackpot2 docs say: _"The Current tested and confirmed
  FluidNC version is 3.9.9, and WebUI V3, use anything newer than this with
  caution."_ Source:
  [`jackpot2.md`](https://github.com/V1EngineeringInc/V1EngineeringInc-Docs/blob/master/docs/electronics/jackpot2.md),
  rendered at [docs.v1e.com](https://docs.v1e.com/electronics/jackpot2/).
- V1's config repo changelog (2026-10-21) says _"Added Mike's 3.0.11, prep for
  4.1.1"_. The 3.0.11 there is the **WebUI** version, not firmware. So V1 is
  preparing to move to FluidNC 4.1.1 but hasn't declared it validated yet.
- Upstream FluidNC releases:
  - 3.9.9: 2025-10-03
  - 4.0.0: 2026-01-02
  - 4.0.4: 2026-08-03
  - 4.1.0: 2026-09-11
  - 4.1.1: 2026-09-23

**Recommendation:** develop and test against **3.9.9**, which is what Jackpot2
users run today. Support 4.1.x from day one, because V1 is about to switch and
it is the better WebSocket implementation.

## Transport: what each firmware actually does

Read from the FluidNC source at tags `v3.9.9` and `v4.1.1`.

| Aspect                                                                | 3.9.9                                                                                                                                                          | 4.1.x                                                                                                                                                                                              |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| WebSocket server                                                      | arduinoWebSockets. **Port 81** (`_port + 1`, the WebUI v2 server) and **port 82** (`_port + 2`, subprotocol `webui-v3`).                                       | ESPAsyncWebServer `AsyncWebSocket("/")` on **port 80**.                                                                                                                                            |
| What camNC connects to                                                | `ws://<ip>:81/`                                                                                                                                                | `ws://<ip>/?independent_session`                                                                                                                                                                   |
| Other clients                                                         | Port 81 leaves other clients alone. **Port 82 disconnects every other client on connect**, so we'd kick the WebUI v3 (and it would kick us). **Never use 82.** | The newest socket of a _session_ closes the older ones. With no cookie (our cross-origin case) all clients share session `""`. `?independent_session` gives a session per socket. Up to 4 clients. |
| Hello message                                                         | `CURRENT_ID:<n>` and `ACTIVE_ID:<n>` (text)                                                                                                                    | `currentID:<n>` and `CURRENT_ID:<n>` (text)                                                                                                                                                        |
| Keepalive                                                             | **No `PING:` handling on port 81**: the text would be fed to the G-code parser as a line. Don't send it; rely on TCP and the status reports.                   | `PING:` is answered with `PING:60000:60000`.                                                                                                                                                       |
| Output                                                                | **Binary** frames, one per line                                                                                                                                | **Binary** frames, coalesced to about 1400 bytes                                                                                                                                                   |
| Input                                                                 | Text or binary frames go into the channel exactly like serial bytes, including realtime chars                                                                  | Same                                                                                                                                                                                               |
| `$Report/Interval`                                                    | Yes, per channel. Also auto-reports G-code modal state changes.                                                                                                | Yes                                                                                                                                                                                                |
| `$Config/Dump`, `$SD/ListJSON`, `$Files/ListGCode`, `$Xmodem/Receive` | Yes                                                                                                                                                            | Yes                                                                                                                                                                                                |
| HTTP CORS headers                                                     | None                                                                                                                                                           | None                                                                                                                                                                                               |

**Is port 81 a problem on 3.9.9?** No.

- For Chrome's Local Network Access (LNA), what matters is that the host is a
  private IP literal or a `.local` name; the port doesn't matter.
- 81 isn't on Chrome's list of blocked ports.
- It's the WebUI v2 socket, which the WebUI v3 that V1 ships doesn't use, so
  camNC and the WebUI can run side by side.
- The only thing to remember is not to send `PING:`.

**Detection:** try `ws://<host>/?independent_session` first (4.x). If the
upgrade fails (3.9.9 serves plain HTTP on 80, so the upgrade is rejected),
try `ws://<host>:81/`. Confirm with `$I` (build info, which includes the
version) and remember the result per machine.

**Browser side.** This relies on Chrome's Local Network Access:

- Chrome 142+ asks for permission before `fetch` calls to the LAN. Chrome
  147+ does the same for WebSockets.
- Once the user grants it, mixed-content blocking is lifted for those
  requests. That's what lets an HTTPS page open `ws://` and `http://`
  connections to the controller.
- The host must be an IP literal or a `.local` name. Default to the IP,
  because `.local` resolution is unreliable on Android and Windows.

Sources: [Chrome blog](https://developer.chrome.com/blog/local-network-access),
[version timeline](https://github.com/GoogleChrome/modern-web-guidance-src/issues/1127),
[WebSocket intent to ship](https://groups.google.com/a/chromium.org/g/blink-dev/c/O6GMKt44Ups).

**Uploads.** No firmware has CORS headers, so we can send to `POST /upload`
(SD) but can't read the response.

- **Primary:** `fetch('http://<ip>/upload', { method: 'POST', mode: 'no-cors', body: formData })`.
  A multipart POST is a CORS "simple" request. Afterwards, verify the
  file and its size with `$SD/ListJSON` over the socket. This gives no
  progress events; show an indeterminate spinner, which is fine for typical
  G-code sizes over Wi-Fi.
- **Fallback, only if the primary proves flaky:** `$Xmodem/Receive=/sd/<name>`
  over the socket. It gives real progress and checksums.
- Check during the spike whether the upload on 3.9.9 needs the
  `path`/`size` form fields the WebUI sends.

## What gets deleted

- `apps/fluidnc-integration`, including its Vercel project and deployment.
- `packages/fluidnc-api`: `fluidnc-api.ts` (`postMessage` wrapper),
  `fluidnc-server.ts` and `fluidnc-client.ts`. Replaced by the new package
  below.
- In camNC:
  - the `fluidncToken` store field (with a migration that drops it)
  - `FluidNcUrlCopyInput`
  - the extension instructions in `routes/setup/fluidnc.tsx`
  - `fluidnc-singleton.ts`
- Docs: the FluidNC parts of `README.md`, `docs/ARCHITECTURE.md` ("Remote
  connections") and `apps/fluidnc-integration/README.md`. The README note
  "Does not work offline … FluidNC needs to run in STA mode" changes to
  "browser and controller must be on the same LAN".
- `@wbcnc/webrtc-channel` and Firebase **stay**, because the phone camera
  (`apps/webrtc-cam`) still uses them.

## New code

### `packages/fluidnc` (replaces `packages/fluidnc-api`)

This package has no React dependency, and every unit in it can be tested
without a browser.

- `FluidncSocket` handles the raw connection:
  - detects the firmware variant (4.x on `/` vs 3.9.9 on `:81`)
  - sets `binaryType = 'arraybuffer'` and decodes with a streaming
    `TextDecoder`
  - splits lines
  - parses the hello message
  - sends `PING:` keepalives on 4.x only
  - reconnects with backoff, but only as a _connection_: nothing that was
    queued is replayed
- `FluidncProtocol` sits on top of the socket:
  - **Command queue.** One line in flight at a time. Each command resolves
    with the lines received before its `ok`, or rejects on `error:N` (with a
    readable message from the error table). It rejects everything pending
    when the socket closes, on `ALARM:N`, or on a reset banner (`Grbl …` /
    `FluidNC …`).
  - **Realtime bytes** bypass the queue: `?`, `!`, `~`, `0x18`, `0x85` (jog
    cancel), and the override bytes `0x90`–`0x9D`.
  - **Unsolicited lines** become typed events:
    - `<…>` status: state, `MPos`/`WPos`, `WCO`, `FS`, `Ov`, `Pn`, `SD`
    - `[GC:…]`
    - `[G54:…]` and the other offsets
    - `[MSG:…]`
    - `[PRB:…]`
    - `ALARM:N`
  - **On connect** it sends `$Report/Interval=200`, then `$I`, `$G`, `$#`.
    There is no more polling of `?` or `$G`.
- `config.ts` reads `$Config/Dump`, parses the YAML and computes axis bounds.
- `files.ts` covers `$SD/ListJSON`, `$SD/Run`, `$SD/Delete`, the `no-cors`
  upload with list verification, and the optional XMODEM sender.
- `parsers/` holds the existing `fluidnc-stream-parser.ts` and
  `fluidnc-axis-bounds.ts` (moved from camNC with their tests), plus new
  parsers for `Ov`, `FS`, `Pn`, `SD`, `ALARM` and error tables, and
  `ListJSON`.
- `testing/FakeFluidnc.ts` is a scripted fake that replays recorded
  transcripts from both firmware versions.

### camNC

- `lib/fluidnc/cnc-api.ts` is rebuilt on `FluidncProtocol`. Keep its public
  signals (`status`, `machinePos`, `currentZero`, …) so the visualize code
  needs little change. Add:
  - `state`
  - `overrides`
  - `jobProgress`
  - `alarm`
  - `connection` (`disconnected | connecting | connected | permission-denied | unreachable`)
- Store: add `machine: { host: string; variant?: 'v3-81' | 'v4' }`, with a
  migration that removes `fluidncToken`.
- `setup/fluidnc` becomes the connection step:
  - enter the IP address
  - "Connect", which shows Chrome's local-network prompt
  - show the detected firmware version
  - on failure, explain why: not Chrome 147+, permission denied, unreachable,
    or wrong network
  - it's optional, as today
- `getFluidSettingsBounds()` switches to `$Config/Dump`, and the
  machine-bounds step keeps working.
- Feature-detect support with a Chrome version check plus
  `navigator.permissions.query({ name: 'local-network' })` where available.
  On unsupported browsers, hide the machine UI and show a note.

## Machine UI (inside camNC)

**MVP (enough to stop opening the WebUI day to day)**

- Toolbar: connection indicator and machine state badge (Idle, Run, Hold,
  Jog, Alarm, Door, Home).
- **Feed hold**, **resume** and **soft reset** buttons, always visible while
  connected. Plus `$X` unlock and `$H` home.
- DRO: MPos/WPos, active WCS, feed/spindle and overrides.
- Jog panel:
  - step sizes
  - XY and Z buttons
  - keyboard jog with `$J=G91 …`, sending `0x85` cancel on key-up
  - the existing click-to-move on the camera view stays
  - jogging is only enabled when the state is Idle or Jog
- Zeroing: the existing camera XY zero, plus Z zero and "zero all".
- Job:
  - upload the current G-code
  - confirm, showing the warnings from `gcodeChecks.ts`
  - `$SD/Run`
  - draw progress from `SD:` on the toolpath
  - pause, resume and stop
- Console drawer: input with history, status lines filtered out,
  `error:`/`ALARM:` lines highlighted with readable text.

**Later**

- SD file manager
- Macros
- Probing (`G38.2`, Z plate)
- Override sliders
- Read-only `$CD` config view

Firmware settings, OTA updates and Wi-Fi setup stay in the WebUI.

## Safety rules

- Commands fail immediately while disconnected. Motion is never re-sent after
  a reconnect.
- Feed hold and reset are realtime bytes, outside the queue.
- An alarm or a reset banner flushes and rejects every pending command.
- Use a single controlling tab (Web Locks API), so two camNC tabs can't drive
  the machine at once.

## Testing and the dev loop

### Which simulator

| Build                                   | Web server / WebSocket                                                                                                                                                                                    | Reachable from a normal browser `WebSocket`?                                                                                                                                                                                                                                                | Use                                                                     |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `env:wasm` at **v4.1.1**                | **No.** `-<WebUI>` in `platformio.ini`; console channel only.                                                                                                                                             | No                                                                                                                                                                                                                                                                                          | Not useful for the transport.                                           |
| `env:wasm` on **`main`** (unreleased)   | Yes: the real `WebUI/` server on `BrowserAsyncTCP` with "virtual connections". `demo/vnet-host.js` `createClient()` provides HTTP and `websocket()`, and works headless in Node (`vnet_client_test.mjs`). | **No.** Sockets are virtual: in the demo, a Service Worker plus a `window.WebSocket` shim inside an iframe, and the page needs COOP/COEP. Hosting it inside camNC would mean cross-origin isolation, which conflicts with camNC's cross-origin resources (camera streams, Clerk, Firebase). | Optional later: in-browser "demo machine"; zero-toolchain Node harness. |
| `env:linux` / `env:macos` at **v4.1.1** | **Yes:** the real `WebUI/` server and `WSChannel` on `PosixAsyncTCP` (real TCP).                                                                                                                          | **Yes:** `ws://127.0.0.1:<port>/`. Loopback from the camNC dev server isn't mixed content. From `https://run.camnc.app` Chrome asks for `loopback-network` permission.                                                                                                                      | **Primary dev and CI target for 4.x.**                                  |
| 3.9.9 (any)                             | No posix or WASM build with WebUI exists.                                                                                                                                                                 | –                                                                                                                                                                                                                                                                                           | Needs the adapter below.                                                |

So the WASM simulator is _not_ the fastest loop today. Its web server isn't in
a release, and it can't be reached by the real browser `WebSocket` that
`FluidncSocket` uses. The native v4.1.1 build is: same server code, real TCP,
real browser API.

### Loop

1. **`pnpm sim`**: start FluidNC v4.1.1 `linux_x86_64` in Docker.
   - The image is pinned by tag, so it gives the same binary on macOS and
     Windows; `windows_x86` excludes WebUI.
   - It's seeded with an adapted `JP2_LR/config.yaml`: pins → `NO_PIN`,
     `stepping.engine: timed`.
   - The HTTP port is mapped to `127.0.0.1:8080`.
   - Check during the spike: how the posix build picks its HTTP port (`$HTTP/Port`
     persisted in the emulated NVS, or `-c` start-up commands) and whether the
     `SD:` job progress and simulated motion (`posix/simulator_engine.cpp`)
     look realistic.
2. **`pnpm sim --v3`**: the same, plus a small **3.9.9 personality proxy** in
   `packages/fluidnc/testing/`.
   - It's a Node `ws` server on `:8081` that forwards to the v4 sim and
     rewrites the transport differences to match 3.9.9 port 81:
     - `CURRENT_ID`/`ACTIVE_ID` hello
     - one binary frame per line
     - `PING:` passed through as input (as 3.9.9 does), instead of answered
     - plain-HTTP 404 on the port-80 WebSocket upgrade, so variant detection
       is exercised
   - The G-code/`$` protocol is the same in both versions; text differences
     (`$I`, `[MSG:]` wording) are covered by transcripts.
3. **camNC dev server** on `localhost`, with the machine host set to
   `127.0.0.1:8080` (or `:8081`), gives a full UI loop without hardware.
4. **Vitest** integration suite runs against both personalities: connect,
   variant detection, auto-report, jog/cancel, `G10`, `$CD` bounds,
   `no-cors` upload + `$SD/ListJSON` + `$SD/Run`, feed hold, reset mid-job,
   and socket kill mid-job (no replay). CI runs the same Docker image.
5. **Unit tests** run the protocol and parsers against `FakeFluidnc`
   transcripts recorded from the real Jackpot2 on 3.9.9 (and 4.1.1 once
   flashed). Transcripts are the source of truth for 3.9.9 quirks.
6. **Hardware smoke before each release, on the Jackpot2:**
   - Chrome desktop and Chrome Android, from `https://run.camnc.app`
   - covers what no simulator can: the LNA prompt, real Wi-Fi drops,
     ESP32 heap/timing, and I2S/TMC2226 stepping

Possible later steps:

- If FluidNC releases the WASM web server, a tiny Node wrapper (WASM +
  `createClient` behind a real `ws` server) would replace Docker with a
  pure `pnpm` dependency.
- The in-browser WASM build could become a "demo machine" on the website
  page, separate from camNC so COOP/COEP doesn't leak into the app.

## Phases

| Phase | Scope                                                                                                                                                                                                                                                                                                                                                                                             | Size      |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| 0     | Spike from `run.camnc.app` on Chrome 147+ against the Jackpot2. On **3.9.9**: `ws://<ip>:81/`, permission prompt, `$Report/Interval`, `$CD`, `no-cors` upload + `$SD/ListJSON`. On **4.1.1** (if you're willing to flash it): `ws://<ip>/?independent_session`. Record transcripts of both. In parallel: Docker image for the v4.1.1 `linux_x86_64` sim, connect to it from the camNC dev server. | 1–2 days  |
| 1     | `packages/fluidnc` (socket, protocol, parsers, fake, 3.9.9 personality proxy, `pnpm sim`). Delete the extension, the relay and the token. `CncApi` on the new package. Connection setup step. Existing features (click-to-move, XY zero, upload + run, bounds) working directly.                                                                                                                  | ~1 week   |
| 2     | MVP machine UI: DRO, realtime buttons, jog, zero, job progress, console, alarms. CI job running the integration suite against the sim (v4 and v3 personality).                                                                                                                                                                                                                                    | 2–3 weeks |
| 3     | File manager, macros, probing, overrides.                                                                                                                                                                                                                                                                                                                                                         | as needed |
| 4     | Optional upstream FluidNC PR: opt-in CORS origin setting (readable `/upload` responses with progress) and a WebSocket `Origin` allow-list.                                                                                                                                                                                                                                                        | optional  |

## Alternatives considered and dropped

The first version of this plan also covered:

- a bridge page served from the SD card and opened as a popup (for
  Safari/Firefox)
- Web Serial over USB
- a headless WebRTC bridge on the camera host
- HTTPS or WebRTC in the firmware
- keeping the WebUI extension

They're dropped in favour of Chrome-only simplicity. The bridge popup is the
natural fallback if Safari or Firefox support is ever needed, and Web Serial
if offline/AP-mode use is needed. Neither requires changing the protocol
layer.
