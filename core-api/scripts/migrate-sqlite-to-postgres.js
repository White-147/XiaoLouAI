require("../src/env").loadEnvFiles();

const { DatabaseSync } = require("node:sqlite");
const { existsSync } = require("node:fs");
const { resolve } = require("node:path");
const { Pool } = require("pg");
const { DEFAULT_DATABASE_URL } = require("../src/postgres-store");
const {
  checksum,
  ensurePostgresSchema,
  syncSnapshotProjections,
} = require("../src/postgres-schema");

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--sqlite") {
      args.sqlite = argv[index + 1];
      index += 1;
    } else if (arg === "--snapshot-key") {
      args.snapshotKey = argv[index + 1];
      index += 1;
    }
  }
  return args;
}

function readSqliteSnapshot(sqlitePath) {
  if (!existsSync(sqlitePath)) {
    throw new Error(`SQLite database not found: ${sqlitePath}`);
  }

  const db = new DatabaseSync(sqlitePath, { readOnly: true });
  try {
    const row = db
      .prepare("SELECT state_value FROM app_state WHERE state_key = 'snapshot' LIMIT 1")
      .get();
    if (!row?.state_value) {
      throw new Error(`No app_state.snapshot row found in ${sqlitePath}`);
    }

    const snapshot = JSON.parse(row.state_value);
    if (snapshot?._snapshotError || snapshot?._snapshotTruncated) {
      throw new Error("SQLite snapshot is truncated or errored; refusing PostgreSQL import");
    }
    return snapshot;
  } finally {
    db.close();
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const sqlitePath = resolve(
    args.sqlite ||
      process.env.CORE_API_DB_PATH ||
      resolve(__dirname, "..", "data", "demo.sqlite"),
  );
  const snapshotKey = args.snapshotKey || "snapshot";
  const snapshot = readSqliteSnapshot(sqlitePath);
  const serialized = JSON.stringify(snapshot);

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL || DEFAULT_DATABASE_URL,
    max: 1,
  });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("CREATE EXTENSION IF NOT EXISTS pgcrypto");
    await client.query("CREATE EXTENSION IF NOT EXISTS citext");
    await ensurePostgresSchema(client);
    await client.query(
      `INSERT INTO legacy_state_snapshot
         (snapshot_key, snapshot_value, snapshot_checksum, imported_at, updated_at)
       VALUES ($1, $2::jsonb, $3, now(), now())
       ON CONFLICT (snapshot_key) DO UPDATE SET
         snapshot_value = excluded.snapshot_value,
         snapshot_checksum = excluded.snapshot_checksum,
         imported_at = excluded.imported_at,
         updated_at = excluded.updated_at`,
      [snapshotKey, serialized, checksum(snapshot)],
    );
    const projections = await syncSnapshotProjections(client, snapshot, {
      source: `sqlite:${sqlitePath}`,
      replace: true,
    });
    await client.query("COMMIT");

    console.log(`imported sqlite snapshot: ${sqlitePath}`);
    console.log(`postgres snapshot key: ${snapshotKey}`);
    for (const [entity, rows] of Object.entries(projections)) {
      console.log(`${entity}: ${rows.length}`);
    }
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {}
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
