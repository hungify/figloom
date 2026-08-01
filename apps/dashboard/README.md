# Figloom Dashboard

Vue dashboard for live and archived Figloom visual-verification runs.

Stack:

- Vue 3
- Vite
- Nuxt UI
- Vue Router file-based routing
- CLI-provided HTTP API, artifact files, and SSE events

Dashboard renders verification state only. Capture, comparison, gates, artifact persistence, and server remain owned by `@figloom/verify` and `figloom-verify`.

## Routes

Routes come from files under `pages/`:

```text
pages/
├── index.vue                 # /
└── contracts/
    └── [...id].vue           # /contracts/:id(.*)
```

Vue Router generates `typed-router.d.ts`. Do not edit generated file manually.

## Quick preview

From repository root:

```bash
pnpm dev:dashboard
```

Open URL printed by Vite. Dashboard starts with mock evidence and HMR; no contract, artifact, or backend required.

Mock source lives in `mocks/dashboard.ts`. It covers:

- Passed, failed, and blocked states.
- Figma and web baselines.
- Viewport and element captures.
- Baseline, actual, scrub, diff, and split inspector modes.
- Missing evidence state.

## Run with HMR

For real artifact/API integration, start archived dashboard backend from repository root:

```bash
pnpm build
pnpm figloom open \
  --artifact /absolute/path/to/visual-verification.json \
  --no-open
```

Backend prints URL such as:

```text
Dashboard: http://127.0.0.1:43127
```

Keep backend running. Start Vite in second terminal:

```bash
FIGLOOM_API_ORIGIN=http://127.0.0.1:43127 pnpm dev:dashboard
```

Equivalent command from this directory:

```bash
FIGLOOM_API_ORIGIN=http://127.0.0.1:43127 pnpm dev
```

Open URL printed by Vite, normally `http://localhost:5173`.

Vite proxies these endpoints to `FIGLOOM_API_ORIGIN`:

- `/api`
- `/artifacts`
- `/events`

Without `FIGLOOM_API_ORIGIN`, Vite serves mock API and artifact responses.

## Run full product

Use CLI when testing bundled production dashboard, live job progress, or browser auto-open:

```bash
pnpm build
pnpm figloom verify \
  --project-root "$PWD" \
  --contract /absolute/path/to/visual-contract.json \
  --output /absolute/path/to/visual-verification.json \
  --ui
```

Add `--no-open` to prevent browser auto-open. Process keeps dashboard available until `Ctrl+C`.

## Build and validate

From repository root:

```bash
pnpm --filter @figloom/dashboard typecheck
pnpm --filter @figloom/dashboard build
```

Or run complete workspace validation:

```bash
pnpm validate
```

Production build writes into `packages/cli/dist/dashboard`. CLI npm package ships generated directory.

## Data flow

```text
GET /api/run       -> current DashboardRun snapshot
GET /api/meta      -> live/archive mode
GET /artifacts/*   -> baseline, actual, and diff images
GET /events        -> live SSE progress events
```

Portable static reports load `./data/visual-verification.json` and `./data/*` instead. Dashboard contains no database, cloud client, or verification-engine dependency.
