# core-api

Backend for XiaoLou AI 创作平台. Runs on Node.js built-in HTTP modules.
This package is now the transition/compatibility API while the production
.NET control plane is being built under `../control-plane-dotnet`.

## What it provides

- REST endpoints for projects, scripts, assets, storyboards, videos, dubbings, tasks, wallet, enterprise, toolbox, and canvas operations.
- Server-sent events at `/api/tasks/stream` for task progress.
- PostgreSQL-backed runtime, with SQLite retained only as migration input and backup.

## Runtime status

Use code truth over older architecture reports: `src/server.js` currently calls
`store-factory.js`, which creates `PostgresStore`. It does not directly
instantiate the old `SqliteStore`. SQLite scripts in `scripts/*sqlite*.js` are
migration-only utilities and must not be used as runtime persistence.

New production work should land in `control-plane-dotnet/` first. During P1
cutover, run core-api as a read-only compatibility surface:

```text
CORE_API_COMPAT_READ_ONLY=1
```

In that mode, core-api rejects `POST` / `PUT` / `PATCH` / `DELETE` with
`CORE_API_COMPAT_READ_ONLY`; reads can remain available while old frontend or
operator screens are retired or proxied to the .NET control plane.

## Quick start

```bash
cd core-api
npm install
cp .env.example .env.local   # then fill in your API keys
npm run dev
```

Default port: **4100**

## Environment variables

Copy `.env.example` -> `.env.local` and set your keys:

```text
YUNWU_API_KEY=your_real_key          # required for image / video generation
YUNWU_BASE_URL=https://yunwu.ai      # default
```

Optional overrides:

```text
PORT=4100
HOST=::                              # :: = all interfaces (default); 127.0.0.1 = local only
CORE_API_PUBLIC_BASE_URL=https://your-domain.com   # for single-origin tunnel mode
DATABASE_URL=postgres://root:root@127.0.0.1:5432/xiaolou
READ_DATABASE_URL=postgres://root:root@127.0.0.1:5432/xiaolou
PGBOUNCER_DATABASE_URL=postgres://root:root@127.0.0.1:6432/xiaolou
POSTGRES_USER=root
POSTGRES_PASSWORD=root
POSTGRES_DB=xiaolou
DATABASE_PUBLIC_URL=postgres://root:root@218.92.180.214:5432/xiaolou
VR_DATABASE_URL=postgres://root:root@127.0.0.1:5432/xiaolou
PYTHON_API_INTERNAL_BASE_URL=http://127.0.0.1:8000
JAAZ_DATABASE_URL=postgres://root:root@127.0.0.1:5432/xiaolou
PGPOOL_MAX=10
POSTGRES_ALLOW_EMPTY_BOOTSTRAP=0
CORE_API_DB_PATH=./data/demo.sqlite  # migration-only import source; never runtime
CORE_API_UPLOAD_DIR=./uploads        # upload directory, relative to core-api/
```

## PostgreSQL migration

After cutover, PostgreSQL is the only runtime write target. SQLite is retained
only as the stopped migration source and rollback backup. The first PostgreSQL
stage keeps the full app snapshot in `legacy_state_snapshot.snapshot_value`
and also projects high-value entities into explicit management tables such as
`users`, `wallets`, `projects`, `project_assets`, `storyboards`, `videos`,
`dubbings`, `tasks`, `canvas_projects`, `create_studio_*`, and
`playground_*`. Video-replace job metadata is moved into `video_replace_jobs`,
and Jaaz canvas/chat/workflow data is moved into `jaaz_*` tables.

Bootstrap the requested local management account/database:

```bash
cd core-api
psql -f db/init-root.psql postgres
```

Credentials:

```text
database: xiaolou
user: root
password: root
url: postgres://root:root@127.0.0.1:5432/xiaolou
public url: postgres://root:root@218.92.180.214:5432/xiaolou
```

If PostgreSQL is installed on `218.92.180.214`, apply local/IP access on that
server before importing or connecting remotely:

```powershell
powershell -ExecutionPolicy Bypass -File db/configure-postgres-network.ps1 -DataDir "D:\soft\program\PostgreSQL\18\data"
```

The script configures `listen_addresses = 'localhost,218.92.180.214'`, adds
loopback plus `218.92.180.214/32` to `pg_hba.conf`, and opens TCP `5432` in
Windows Firewall when run as Administrator. Restart the PostgreSQL service
afterward.

Stop core-api before importing so SQLite cannot receive new writes, then run:

```bash
npm run db:backup-sqlite
npm run db:migrate
npm run db:import-sqlite
npm run db:import-vr-sqlite
npm run db:import-jaaz-sqlite
npm run db:cutover:postgres
```

`db:cutover:postgres` verifies `legacy_state_snapshot` exists, then writes the
PostgreSQL runtime settings into `.env.local`:

```text
DATABASE_URL=postgres://root:root@127.0.0.1:5432/xiaolou
DATABASE_PUBLIC_URL=postgres://root:root@218.92.180.214:5432/xiaolou
VR_DATABASE_URL=postgres://root:root@127.0.0.1:5432/xiaolou
JAAZ_DATABASE_URL=postgres://root:root@127.0.0.1:5432/xiaolou
PGPOOL_MAX=10
POSTGRES_ALLOW_EMPTY_BOOTSTRAP=0
```

Use `npm run db:cutover:postgres -- --use-public` only when the core-api
process should connect through `218.92.180.214`; same-host deployments should
prefer `127.0.0.1`. The same runtime switch is also committed as
`.env.postgres.example` for easy copying into `.env.local`.

PostgreSQL mode refuses to bootstrap an empty snapshot by default, so an
accidental start before `db:import-sqlite` fails loudly instead of replacing the
current SQLite data with seed data. For a brand-new demo-only PostgreSQL
database, set `POSTGRES_ALLOW_EMPTY_BOOTSTRAP=1`.

Then restart core-api and verify:

```bash
npm run verify:postgres
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

Demo mock recharge is local-only by default. The current mock flow supports both WeChat Pay and Alipay demo orders:

```text
PAYMENT_MOCK_ALLOWED_HOSTS=localhost,127.0.0.1,::1
```

Do not use `*` in production. If an internal QA surface needs mock recharge,
list explicit hostnames such as `localhost,127.0.0.1,qa.xiaolouai.cn`.

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

- `/` -> frontend port 3000
- `/api` and `/uploads` -> core-api port 4100

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

Also creates a project, restarts, and confirms persistence.

## Handy requests

```powershell
Invoke-RestMethod http://127.0.0.1:4100/api/projects
Invoke-RestMethod http://127.0.0.1:4100/api/projects/proj_demo_001/overview
Invoke-RestMethod http://127.0.0.1:4100/api/toolbox
Invoke-RestMethod -Method Post http://127.0.0.1:4100/api/demo/reset
```

## Notes

- Runtime persistence is PostgreSQL-only; SQLite files are read only by the migration/backup scripts.
- `POST /api/demo/reset` restores the seeded demo dataset.
- Canvas API: `/api/canvas/*` and `/api/canvas-library/*` (legacy aliases `/twitcanva-api/*` preserved).
- Response envelope: `{ success, data?, error?, meta? }`.

## Video Replace architecture (Windows-native transition)

`core-api` is now a compatibility surface only. The long-term control plane is
`control-plane-dotnet/`, and durable work must flow through PostgreSQL `jobs`
and Windows Service workers. Python may still run local model adapter code such
as `video-replace-service/vr_pipeline_cli.py`, but it must not become the main
control plane or a Celery-based async foundation.

During cutover, compatibility traffic may still enter **core-api at port 4100**.
New production work should target the .NET control plane and the PostgreSQL
queue contract:

```text
browser
   -> .NET control API (4100)
        -> PostgreSQL jobs/job_attempts
        -> Windows Service local-model-worker
             -> optional Python model adapter / inference runner
```

Orphan GPU prevention:

- core-api persists `pipeline_pid` (outer Python) and `subprocess_pid` (VACE
  grandchild) into the PostgreSQL `video_replace_jobs` table.
- On startup, core-api scans every non-terminal job, kills any still-alive
  PID tree via `taskkill /T /F` (Windows) / `kill -KILL -pgid` (POSIX), and
  marks the job failed with a clear "startup reap / previous crash" message.
- On shutdown (SIGINT / SIGTERM / SIGBREAK), core-api kills every live
  pipeline tree before letting the HTTP server close.
- A hard wall-clock supervisor (default 1 h, override via
  `VR_PIPELINE_TIMEOUT_MS`) cuts any pipeline that refuses to terminate.

`video-replace-service/app/main.py` (old FastAPI standalone on 4200) is
**legacy debug** only and not part of the default stack.
