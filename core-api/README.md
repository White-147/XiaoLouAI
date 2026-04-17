# core-api

Backend for XiaoLou AI 创作平台. Runs on Node.js built-in HTTP modules, persists state in SQLite.

## What it provides

- REST endpoints for projects, scripts, assets, storyboards, videos, dubbings, tasks, wallet, enterprise, toolbox, and canvas operations.
- Server-sent events at `/api/tasks/stream` for task progress.
- SQLite-backed seed data — boots with a realistic demo project and survives restarts.

## Quick start

```bash
cd core-api
npm install
cp .env.example .env.local   # then fill in your API keys
npm run dev
```

Default port: **4100**

## Environment variables

Copy `.env.example` → `.env.local` and set your keys:

```text
YUNWU_API_KEY=your_real_key          # required for image / video generation
YUNWU_BASE_URL=https://yunwu.ai      # default
```

Optional overrides:

```text
PORT=4100
HOST=::                              # :: = all interfaces (default); 127.0.0.1 = local only
CORE_API_PUBLIC_BASE_URL=https://your-domain.com   # for single-origin tunnel mode
CORE_API_DB_PATH=./data/demo.sqlite  # SQLite path, relative to core-api/
CORE_API_UPLOAD_DIR=./uploads        # upload directory, relative to core-api/
```

The backend auto-loads env files from these locations (first match wins per key):

1. `core-api/.env.local`
2. `core-api/.env`
3. repo-root `.env.local` / `.env`
4. `XIAOLOU-main/.env.local` / `.env`

## Run without npm script

```bash
node src/server.js
```

Override port inline:

```bash
PORT=4200 node src/server.js
```

## Single-origin tunnel mode

Expose via one public domain for both frontend and API:

- `/` → frontend port 3000
- `/api` and `/uploads` → core-api port 4100

Set this in `core-api/.env.local`:

```text
CORE_API_PUBLIC_BASE_URL=https://your-domain.com
```

Set `VITE_CORE_API_BASE_URL` to the same origin in `XIAOLOU-main/.env.local`.

## API Keys reference

| Key | Used for | Where to get |
|-----|----------|--------------|
| `YUNWU_API_KEY` | Image / video generation (Yunwu gateway) | https://yunwu.ai |
| `VOLCENGINE_ARK_API_KEY` | Seedance 2.0 video (Volcengine Ark, optional fallback) | https://console.volcengine.com/ark |
| `PIXVERSE_API_KEY` | PixVerse video (optional) | https://app.pixverse.ai |

## Smoke test

```bash
npm run verify
```

Starts on a random port, checks:
- `/healthz`
- `/api/projects`
- `/api/projects/:id/overview`
- `/api/toolbox/capabilities`

Also creates a project, restarts, and confirms SQLite persistence.

## Handy requests

```powershell
Invoke-RestMethod http://127.0.0.1:4100/api/projects
Invoke-RestMethod http://127.0.0.1:4100/api/projects/proj_demo_001/overview
Invoke-RestMethod http://127.0.0.1:4100/api/toolbox
Invoke-RestMethod -Method Post http://127.0.0.1:4100/api/demo/reset
```

## Notes

- Uses Node built-in `node:sqlite` (Node ≥ 22.5). Prints an experimental warning on Node 24 — safe to ignore.
- `POST /api/demo/reset` restores the seeded demo dataset.
- Canvas API: `/api/canvas/*` and `/api/canvas-library/*` (legacy aliases `/twitcanva-api/*` preserved).
- Response envelope: `{ success, data?, error?, meta? }`.
