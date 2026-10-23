# Signal

WebRTC signalling relay for camNC, on Cloudflare Workers. Each room is one
`SignalRoom` Durable Object holding the room's WebSockets through the
[Hibernation API](https://developers.cloudflare.com/durable-objects/best-practices/websockets/).
It stores nothing: presence lives in the socket attachments, and the object
only relays `join`, `leave` and `signal` messages. Peers switch to in-band
signalling over their data channel once connected.

The client is `WsSignaller` in `@wbcnc/webrtc-channel`; the wire protocol is in
`packages/webrtc-channel/signal-protocol.ts`.

```bash
pnpm --filter @wbcnc/signal dev      # local worker on ws://localhost:8787
pnpm --filter @wbcnc/signal test     # tests in workerd
pnpm --filter @wbcnc/signal deploy   # needs wrangler login or CLOUDFLARE_API_TOKEN
```

Point an app at a local worker with `?signalUrl=ws://localhost:8787`.

## Configuration (`wrangler.jsonc`)

- `ALLOWED_ORIGINS`: comma separated origins allowed to connect, `*` matches
  within a host (e.g. `https://*.workers.dev`). Requests without an `Origin`
  header (non-browser clients) are allowed; this only stops other websites from
  using the relay.
- `CONNECT_LIMITER`: new connections per IP and minute.
- `routes`: the production hostname, `signal.camnc.app`. Must match
  `SIGNAL_URL` in `@wbcnc/public-config/signal`.

Room ids are a SHA-256 of the access token (`roomIdFromToken`), so tokens never
reach the worker or its logs.
