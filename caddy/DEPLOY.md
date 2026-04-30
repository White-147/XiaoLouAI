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

If the deployment domain is not `www.xiaolouai.cn`, `www.xiaolou.cn`, or
`aitianmu.cn`, update the site blocks in `Caddyfile` before starting Caddy.
