# camNC app

Main application that overlays CNC G-code on a live, calibrated camera feed.
A client-side React SPA (TanStack Router, react-three-fiber) served by a Cloudflare Worker
(`worker/`) that also stores signed-in users' settings in D1. See
[docs/ARCHITECTURE.md](../../docs/ARCHITECTURE.md) for an overview.

## Development

```bash
cp .env.example .env.local   # and fill in the values
pnpm dev --filter @wbcnc/camNC   # from the repo root
```

- `pnpm dev:api` – run the settings API Worker locally with a local D1 database
  (copy `.dev.vars.example` to `.dev.vars` first). `pnpm dev` proxies `/api` to it; without it,
  the app works signed out and settings stay in localStorage.
- `pnpm test` – Worker API tests (workerd) and browser tests (Vitest + Playwright/Chromium).
- `pnpm db:generate` – generate a D1 migration in `migrations/` after changing `worker/schema.ts`.

## Deployment

`wrangler.jsonc` defines the `camnc` Worker (static assets from `dist/`, `/api/*` handled by
`worker/index.ts`) and a `preview` env (`camnc-preview` Worker, `camnc-preview` D1 database,
Clerk development keys). Both Workers deploy through Cloudflare Workers Builds, connected to this
repository in the Cloudflare dashboard (plainoss account):

| Setting                                     | `camnc`                                                  | `camnc-preview`           |
| ------------------------------------------- | -------------------------------------------------------- | ------------------------- |
| Root directory                              | `apps/camNC`                                             | `apps/camNC`              |
| Build command                               | `cd ../.. && pnpm turbo run build --filter @wbcnc/camNC` | same                      |
| Deploy command (`main`)                     | `pnpm run deploy`                                        | `pnpm run deploy:preview` |
| Preview command (other branches)            | builds off                                               | `pnpm run deploy:preview` |
| Build variable `VITE_CLERK_PUBLISHABLE_KEY` | Clerk production key                                     | Clerk development key     |

Cloudflare posts the preview URL on each PR. Both deploy scripts apply pending D1 migrations first.

Worker secrets (`wrangler secret put`, add `--env preview` for previews): `CLERK_SECRET_KEY`,
`CLERK_PUBLISHABLE_KEY`, and optionally `CLERK_JWT_KEY` for networkless session verification.

## Setup smoke test

Run the complete setup against production in an isolated, signed-out browser:

```bash
pnpm exec playwright install chromium # once
pnpm --filter @wbcnc/camNC smoke:setup
```

To target a local or preview deployment instead:

```bash
CAMNC_SMOKE_URL=http://localhost:5174 pnpm --filter @wbcnc/camNC smoke:setup
```

The test uses a fixed English locale and supplies a synthetic webcam with 12 perspective
chessboard views and four ArUco markers. The application's actual OpenCV workers detect the images and solve
calibration and camera pose. It also checks form validation, persistence, G-code bounds,
pause/resume, tool settings, and configuration export/import. For FluidNC it checks both
skipping setup and pairing the deployed widget over WebRTC, then reading simulated
controller bounds. The simulated WebUI host accepts only read requests; the test never
connects to a real CNC controller or sends motion commands.

Set `CAMNC_SMOKE_HEADED=1` to watch it. Reports and screenshots are written to
`output/playwright/setup-smoke/` at the repository root; failures also retain a Playwright
trace. `CAMNC_SMOKE_OUTPUT` overrides this directory. The **Production setup smoke**
GitHub Actions workflow runs it after Cloudflare reports a successful `camnc` build on `main`,
daily, and on demand with downloadable artifacts, and checks smoke-test changes on pull requests
against production.
