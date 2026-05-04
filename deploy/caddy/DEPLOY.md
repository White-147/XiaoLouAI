# XiaoLou Caddy deployment

Status: Windows Caddy support note. The canonical production example remains
`deploy/windows/Caddyfile.windows.example`; this directory contains the
same-host convenience Caddyfile used by `scripts\start_caddy.cmd`.

The current production reverse proxy must send API traffic on port `4100` to
the `.NET` Control API Windows Service, and must serve `XIAOLOU-main/dist` as a
static SPA. Do not route production traffic to `core-api/`, `services/api/`, a
Vite dev/preview server, Docker, Linux, Kubernetes, Windows + Celery, or Redis
Open Source on Windows.

G2b-2 moved the former root legacy references `core-api/` and `services/api/`
to `legacy/core-api` and `legacy/services-api`; G7d-3 moved the former root
upstream Jaaz reference to `legacy/jaaz`. Do not use these archived paths as
reverse-proxy backends or production working directories. Follow the validation
records in `docs/xiaolouai-legacy-physical-archive-contract.md` and
`docs/xiaolouai-top-level-directory-organization-inventory.md`.

The repository intentionally does not commit `caddy.exe`, downloaded archives,
logs, or pid files. Install Caddy on the target machine, or download the
matching binary from the official Caddy release page.

Windows local start:

```cmd
scripts\start_caddy.cmd
```

Portable start after installing Caddy:

```bash
caddy run --config deploy/caddy/Caddyfile
```

Before public deployment with the supported Windows route, confirm these
services are running:

- Frontend: `XIAOLOU-main/dist` static files served by Caddy or IIS
- Backend: `.NET` Control API Windows Service, port `4100`
- Database: PostgreSQL `xiaolou`, user `root`, port `5432`

If the deployment domain is not `www.xiaolouai.cn`, `www.xiaolou.cn`, or
`aitianmu.cn`, update the site blocks in `Caddyfile` before starting Caddy.

Historical Node-era PostgreSQL cutover commands are retained only as migration
reference. Do not run them as the production deployment path:

```bash
cd legacy/core-api
npm run db:backup-sqlite
npm run db:migrate
npm run db:import-sqlite
npm run db:import-vr-sqlite
npm run db:import-jaaz-sqlite
npm run db:cutover:postgres
```

Historical reference only: old `core-api/.env.local` examples looked like this
during Node-era cutover:

```text
DATABASE_URL=postgres://root:root@127.0.0.1:5432/xiaolou
DATABASE_PUBLIC_URL=postgres://root:root@218.92.180.214:5432/xiaolou
VR_DATABASE_URL=postgres://root:root@127.0.0.1:5432/xiaolou
JAAZ_DATABASE_URL=postgres://root:root@127.0.0.1:5432/xiaolou
PGPOOL_MAX=10
POSTGRES_ALLOW_EMPTY_BOOTSTRAP=0
```

Same-host backend processes should use `127.0.0.1`; remote management tools can
use `218.92.180.214` after PostgreSQL listen/pg_hba/firewall configuration is
applied on that server.
