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
`worker/index.ts`) and its Worker Previews (`previews` block). GitHub Actions deploys it
(`.github/workflows/ci.yml`, plainoss account), after the tests pass and from the same build:

| Trigger                         | Command                                      | Database        | Clerk keys  |
| ------------------------------- | -------------------------------------------- | --------------- | ----------- |
| Push to `main`                  | `pnpm run deploy`                            | `camnc`         | production  |
| Pull request from a branch here | `pnpm run deploy:preview --name pr-<number>` | `camnc-preview` | development |
| Pull request closed             | `wrangler preview delete --name pr-<number>` |                 |             |

The preview job comments the Preview URL on the PR. Fork PRs get no preview. Both deploy scripts
apply pending D1 migrations first. Preview migrations use `wrangler.preview-migrations.jsonc`, which
only knows the `camnc-preview` database, so branch code can't migrate production.

The app reads the Clerk publishable key from `GET /api/config`, so production and previews share
one build. `VITE_CLERK_PUBLISHABLE_KEY` in `.env.local` is only the fallback for `pnpm dev` without
`dev:api`.

Setup (once):

- GitHub repository secret `CLOUDFLARE_API_TOKEN`: an API token for the plainoss account with
  Workers Scripts: Edit and D1: Edit.
- Production secrets (`wrangler secret put`): `CLERK_SECRET_KEY`, `CLERK_PUBLISHABLE_KEY`, and
  optionally `CLERK_JWT_KEY` for networkless session verification.
- Preview secrets, Clerk development instance (`wrangler preview base-config secret put`): the same
  three names. New Previews copy them; for an existing Preview use
  `wrangler preview secret put <NAME> --name pr-<number>`.

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
GitHub Actions workflow runs it after CI deploys `main`,
daily, and on demand with downloadable artifacts, and checks smoke-test changes on pull requests
against production.
