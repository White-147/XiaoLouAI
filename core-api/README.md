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

## Alipay recharge payments

Recharge orders use the server-side rule `1 RMB = 2 credits` (`RECHARGE_CREDITS_PER_RMB=2` by default). The browser may send a displayed credit amount, but the backend recalculates the value before creating the payment order.

This integration uses Alipay RSA2 public-key mode. Start with sandbox credentials, complete an end-to-end recharge, then switch `ALIPAY_ENV` to `production` with the production app keys.

```text
ALIPAY_ENV=sandbox
ALIPAY_APP_ID=your_app_id
ALIPAY_PRIVATE_KEY_PATH=./credentials/alipay-app-private-key.pem
ALIPAY_PUBLIC_KEY_PATH=./credentials/alipay-public-key.pem
ALIPAY_SELLER_ID=your_seller_id
PAY_PUBLIC_BASE_URL=https://www.xiaolouai.cn
PAY_RETURN_BASE_URL=https://www.xiaolouai.cn
RECHARGE_CREDITS_PER_RMB=2
```

Configure these URLs in the Alipay console:

```text
notify_url: https://www.xiaolouai.cn/api/payments/alipay/notify
return_url: https://www.xiaolouai.cn/wallet/recharge
```

## Mock recharge visibility

Demo mock recharge is visible to every host/IP by default. The current mock flow supports both WeChat Pay and Alipay demo orders:

```text
PAYMENT_MOCK_ALLOWED_HOSTS=*
```

This keeps the public demo page usable even when visitors open the site by raw IP. To restrict mock recharge later, replace `*` with a comma-separated host list such as `localhost,127.0.0.1,www.xiaolouai.cn`.

## Public Super Admin Login

`root_demo_001` remains loopback-only. To access the admin console from a public domain, configure a real super-admin account in `core-api/.env.local` and restart core-api:

```text
SUPER_ADMIN_EMAIL=admin@xiaolouai.cn
SUPER_ADMIN_PASSWORD=use-a-long-random-password
SUPER_ADMIN_DISPLAY_NAME=超级管理员
```

Then open:

```text
https://www.xiaolouai.cn/admin/login
```

The backend creates or updates this `super_admin` account on startup. The admin login endpoint rejects non-super-admin accounts.

When using any single-origin reverse proxy, `/api/*` and `/uploads/*` must proxy to core-api port 4100 before the catch-all frontend proxy. This is required so Alipay can reach the async notify endpoint.

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
PORT=4101 node src/server.js
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

## Video Replace architecture (default — 4100-only)

All video-replace traffic is terminated inside **core-api at port 4100**.
There is no sidecar HTTP server; Python is invoked as on-demand CLIs:

```
browser (3000, Vite)
   └─▶ core-api (4100, this process)
          ├─ /api/video-replace/upload       → vr_probe_cli.py   (sync, ~1 s)
          ├─ /api/video-replace/jobs/:id/detect → vr_detect_cli.py (async, ~5–15 s)
          └─ /api/video-replace/jobs/:id/generate
                └─▶ spawn vr_pipeline_cli.py (detached, 30–90 min)
                        └─▶ spawn Wan2.1 generate.py (GPU-heavy VACE child)
```

Orphan GPU prevention:

- core-api persists `pipeline_pid` (outer Python) and `subprocess_pid` (VACE
  grandchild) into `tasks.sqlite` as each step starts.
- On startup, core-api scans every non-terminal job, kills any still-alive
  PID tree via `taskkill /T /F` (Windows) / `kill -KILL -pgid` (POSIX), and
  marks the job failed with a clear "startup reap / previous crash" message.
- On shutdown (SIGINT / SIGTERM / SIGBREAK), core-api kills every live
  pipeline tree before letting the HTTP server close.
- A hard wall-clock supervisor (default 1 h, override via
  `VR_PIPELINE_TIMEOUT_MS`) cuts any pipeline that refuses to terminate.

`video-replace-service/app/main.py` (old FastAPI standalone on 4200) is
**legacy debug** only and not part of the default stack — see that file's
top-of-file banner.
