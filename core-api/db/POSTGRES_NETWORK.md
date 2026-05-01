# PostgreSQL local and 218.92.180.214 access

Target credentials:

```text
database: xiaolou
user: root
password: root
local url: postgres://root:root@127.0.0.1:5432/xiaolou
public url: postgres://root:root@218.92.180.214:5432/xiaolou
```

On the PostgreSQL host, create the account/database first:

```powershell
psql -f db/init-root.psql postgres
```

Then configure PostgreSQL to accept loopback plus `218.92.180.214` access:

```powershell
powershell -ExecutionPolicy Bypass -File db/configure-postgres-network.ps1 -DataDir "D:\soft\program\PostgreSQL\18\data"
```

The script backs up `postgresql.conf` and `pg_hba.conf`, sets
`listen_addresses = 'localhost,218.92.180.214'`, writes a managed pg_hba block,
and opens inbound TCP `5432` in Windows Firewall when it has Administrator
permissions. Restart PostgreSQL after running it.

For same-host core-api, keep `DATABASE_URL` pointed at `127.0.0.1`. Use
`218.92.180.214` only for remote management tools or for a core-api process that
must connect through the public/server IP.
