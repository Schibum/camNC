# @wbcnc/fluidnc

Direct WebSocket connection to a FluidNC controller, without the WebUI. No React dependency; everything
runs in Node for tests.

- `FluidncSocket`: transport. Detects FluidNC 4.x (`ws://<host>/?independent_session`) or 3.9.9
  (`ws://<host>:<http port + 1>/`), splits binary output into lines, sends `PING:` keepalives on 4.x only,
  and reconnects with backoff without replaying anything.
- `FluidncProtocol`: one command in flight, resolved by `ok` and rejected by `error:N`. `ALARM:N`, a reset
  banner, a soft reset or a disconnect reject everything pending. Realtime bytes (`!`, `~`, `0x18`, `0x85`,
  overrides) bypass the queue. On connect it sends `$Report/Interval=200`, `$I`, `$G`, `$#`, and polls
  `?` only when auto-reports go quiet.
- `config.ts` (`$Config/Dump` → axis bounds), `files.ts` (`$SD/ListJSON`, run, delete, `no-cors` upload
  verified by listing), `xmodem.ts` (`$Xmodem/Receive` fallback with progress).
- `testing/FakeFluidnc`: scripted controller speaking either transport, seeded from transcripts in
  `src/testing/transcripts`.

## Simulator

```bash
pnpm sim         # FluidNC 4.1.1 posix build on 127.0.0.1:8848 with the JP2 LowRider config
pnpm sim --v3    # plus a 3.9.9 transport proxy: use host 127.0.0.1:8850 in camNC
```

The first run clones FluidNC v4.1.1 and builds it with PlatformIO (`pio`) into `~/.cache/camnc`.
`pnpm sim --docker` builds and runs the linux build in Docker instead.

```bash
FLUIDNC_SIM_HOST=127.0.0.1:8848 pnpm vitest run src/sim.integration.test.ts
```

## Transcripts

`src/testing/transcripts/v4.1.1-sim.json` is recorded from the simulator. The 3.9.9 one is written by hand
until it is recorded from a Jackpot2:

```bash
node scripts/record-transcript.mjs <controller-ip> > src/testing/transcripts/v3.9.9-jackpot2.json
```
