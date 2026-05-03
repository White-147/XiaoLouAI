# core-api

Language: [English](README.md) | [简体中文](README.zh-CN.md)

Backend for XiaoLou AI 创作平台. Runs on Node.js built-in HTTP modules.
This package is now only the transition/read-only compatibility API. Production
control-plane work belongs under `../control-plane-dotnet`.

## What it provides

- Legacy route implementations and migration references for projects, scripts,
  assets, storyboards, videos, dubbings, tasks, wallet, enterprise, toolbox,
  and canvas operations.
- Server-sent events at `/api/tasks/stream` for task progress.
- PostgreSQL-backed runtime, with SQLite retained only as migration input and backup.

## Runtime status

Use code truth over older architecture reports: `src/server.js` currently calls
`store-factory.js`, which creates `PostgresStore`. It does not directly
instantiate the old `SqliteStore`. SQLite scripts in `scripts/*sqlite*.js` are
migration-only utilities and must not be used as runtime persistence.

New production work should land in `control-plane-dotnet/` first. During P1/P2
cutover, core-api defaults to a read-only compatibility surface; keep this
explicit in runtime env:

```text
CORE_API_COMPAT_READ_ONLY=1
```

In that mode, core-api rejects `POST` / `PUT` / `PATCH` / `DELETE` with
`CORE_API_COMPAT_READ_ONLY`. If `CORE_API_COMPAT_PUBLIC_ROUTE_ALLOWLIST` is
not set, read-only mode exposes only `GET /healthz` and
`GET /api/windows-native/status`; all other legacy public reads are closed until
they are deliberately allowlisted or proxied to the .NET control plane.
The Windows smoke also discovers every `POST` / `PUT` / `PATCH` / `DELETE`
route in `src/routes.js` and verifies it returns `410 CORE_API_COMPAT_READ_ONLY`;
`-BlockedWritePaths` remains available for extra hand-written probes.

Current P2 status: frontend legacy write routes have been retired or migrated,
and `/api/projects*`, `/api/canvas-projects*`, `/api/agent-canvas/projects*`,
and `/api/create/images|videos` now have first-batch `.NET` canonical
implementations published to the running Windows service. The identity/config
batch for `/api/auth*`, `/api/me`, `/api/organizations/*/members`, and
`/api/api-center*` is also implemented and published in the `.NET` Control API.
The project-adjacent batch for assets/storyboards/videos/dubbings/exports is
also published and covered by 4100 runtime smoke. The admin/system batch
for `/api/admin/pricing-rules`, `/api/admin/orders`, and
`/api/enterprise-applications*` is now canonical in the `.NET` Control API;
manual admin recharge review remains retired with 410. Playground is also
canonical in `.NET`: `/api/playground/config|models|conversations|chat-jobs|memories`
has been published to the 4100 Windows service, with conversations, messages,
memory preferences, and memories stored in PostgreSQL and chat work enqueued
through canonical `jobs`.
Toolbox is now canonical in `.NET` as well: `/api/capabilities` and
`/api/toolbox*` are backed by `toolbox_capabilities`, `toolbox_runs`, and
canonical `jobs`. Keep the Node toolbox implementations as migration/reference
code only.
Keep core-api closed for those production surfaces; do not reopen old Node
writes to make the frontend work.
When no legacy snapshot is present, read-only mode keeps the seed state in
memory and skips PostgreSQL snapshot/projection writes, so it can smoke test
against the Windows-native canonical test database without requiring legacy
columns such as `users.platform_role`.

Windows smoke command:

```powershell
..\scripts\windows\verify-core-api-compat-readonly.ps1
```

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
CORE_API_COMPAT_READ_ONLY=1
CORE_API_COMPAT_PUBLIC_ROUTE_ALLOWLIST=GET /healthz;GET /api/windows-native/status
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
PGPOOL_MAX=2
POSTGRES_ALLOW_EMPTY_BOOTSTRAP=0
CORE_API_DB_PATH=./data/demo.sqlite  # migration-only import source; never runtime
CORE_API_UPLOAD_DIR=./uploads        # upload directory, relative to core-api/
```

## PostgreSQL migration

After cutover, PostgreSQL is the only runtime write target. SQLite is retained
only as the stopped migration source and rollback backup. The first PostgreSQL
stage keeps the full app snapshot in `legacy_state_snapshot.snapshot_value`
and also projects high-value entities into explicit management tables such as
`users`, `wallets`, `projects`, `project_assets`, `project_storyboards`,
`project_videos`, `project_dubbings`, `project_exports`, `tasks`,
`canvas_projects`, `create_studio_*`, `playground_*`, and `toolbox_*`. Legacy
`storyboards`, `videos`, and `dubbings` can be idempotently projected into the
new `project_*` canonical tables; create-studio media outputs still require
`media_objects` provenance. Video-replace job metadata is moved into
`video_replace_jobs`, and Jaaz canvas/chat/workflow data is moved into `jaaz_*`
tables.

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
PGPOOL_MAX=2
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

This section is legacy/local guidance only. Production Windows-native hosting
serves `XIAOLOU-main/dist` and reverse-proxies only the explicit public .NET
Control API allowlist from the root README and `deploy/windows/*` examples.

For local compatibility comparison, a single-origin tunnel can expose both the
frontend and the legacy compatibility API:

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

For the P1 compatibility boundary, prefer the non-mutating Windows smoke:

```powershell
npm run verify:compat-readonly
```

It starts a full core-api process with `CORE_API_COMPAT_READ_ONLY=1`, verifies
the D: Node runtime and installed `pg` dependency, checks `/healthz` and
`/api/windows-native/status`, and confirms legacy reads/writes are closed by
the compatibility guards. The default closed-read checks cover wallet, jobs,
projects/assets, chat model discovery, auth providers, legacy payment checkout,
canvas/agent-canvas project reads, canvas library reads, and `/uploads/*`.
The default closed-write checks now explicitly cover the P2 legacy main-write
shutdown set: `/api/jobs`, `/api/tasks`, `/api/wallet/recharge-orders`,
`/api/payments/alipay/notify`, `/api/media/upload-begin`, and `/api/uploads`.

For the legacy-to-canonical cutover gate, generate the non-mutating projection
report before closing old write paths:

```powershell
npm run verify:legacy-canonical-projection
```

This checks legacy snapshot/table presence, canonical table readiness,
non-terminal legacy jobs, recharge order/payment event projection, wallet
ledger canonical fields, project-adjacent projection into `project_*` tables,
and create-studio media provenance in `media_objects`. Use `-AllowMissingLegacy`
only when calling the PowerShell script directly against a local canonical smoke
database with no real legacy source.

If the report shows missing account/job/wallet projection, create a reviewed
dry-run plan before writing anything:

```powershell
npm run project:legacy-canonical -- -DatabaseUrl <staging-database-url>
npm run project:legacy-canonical -- -DatabaseUrl <staging-database-url> -Execute
```

`-Execute` is restricted to `legacy_projection_staging_*` schemas by default.
Production projection needs a frozen legacy write window, backup, and the
explicit PowerShell `-AllowNonStaging` switch.

Once old legacy write paths and workers are frozen, rerun the gate with
`-LegacyWritesFrozen` so already projected non-terminal legacy jobs do not keep
showing as warnings. The switch does not bypass missing projection blockers.

## Handy requests

These are local legacy compatibility probes. In production, equivalent
project/canvas/create surfaces should be served by the `.NET` Control API.

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

## README Language Policy

Keep this README and `README.zh-CN.md` in sync. Any future README change should
update both language versions.
