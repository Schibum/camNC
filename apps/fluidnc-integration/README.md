# FluidNC Integration

Extension for the [FluidNC WebUI v3](http://wiki.fluidnc.com/en/features/webui).
It runs inside the WebUI, talks to it via `postMessage` and exposes its API
(commands, file upload/download, status stream) to camNC over WebRTC using
`FluidncServer` from `@wbcnc/fluidnc-api`. camNC links to the deployed
extension from its FluidNC setup page.

```bash
pnpm dev --filter @wbcnc/fluidnc-integration   # from the repo root
```
