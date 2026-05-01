# XiaoLou Caddy deployment

`Caddyfile` is part of the deployable project because XiaoLou uses Caddy as
the single-origin reverse proxy:

- `/api/*`, `/uploads/*`, `/jaaz*`, `/jaaz-api*`, and `/socket.io/*` go to
  `core-api` on port `4100`.
- All other frontend traffic goes to the Vite/preview server on port `3000`.

The repository intentionally does not commit `caddy.exe`, downloaded archives,
logs, or pid files. Install Caddy on the target machine, or download the
matching binary from the official Caddy release page.

Windows local start:

```cmd
scripts\start_caddy.cmd
```

Portable start after installing Caddy:

```bash
caddy run --config caddy/Caddyfile
```

Before public deployment, confirm these services are running:

- Frontend: `XIAOLOU-main`, port `3000`
- Backend: `core-api`, port `4100`
- Database: PostgreSQL `xiaolou`, user `root`, port `5432`

If the deployment domain is not `www.xiaolouai.cn`, `www.xiaolou.cn`, or
`aitianmu.cn`, update the site blocks in `Caddyfile` before starting Caddy.

PostgreSQL cutover must be complete before treating SQLite as retired:

```bash
cd core-api
npm run db:backup-sqlite
npm run db:migrate
npm run db:import-sqlite
npm run db:import-vr-sqlite
npm run db:import-jaaz-sqlite
npm run db:cutover:postgres
```

After cutover, `core-api/.env.local` should contain:

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
