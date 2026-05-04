require("../src/env").loadEnvFiles();

const { DatabaseSync } = require("node:sqlite");
const { existsSync } = require("node:fs");
const { join, resolve } = require("node:path");
const { Pool } = require("pg");
const { ensurePostgresSchema } = require("../src/postgres-schema");
const { DEFAULT_DATABASE_URL } = require("../src/postgres-store");

function resolveDefaultVrServiceDir() {
  const embeddedDir = resolve(__dirname, "..", "video-replace-service");
  const legacyDir = resolve(__dirname, "..", "..", "video-replace-service");
  return existsSync(join(embeddedDir, "vr_probe_cli.py")) ? embeddedDir : legacyDir;
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--sqlite") {
      args.sqlite = argv[index + 1];
      index += 1;
    }
  }
  return args;
}

function readJobs(sqlitePath) {
  if (!existsSync(sqlitePath)) {
    return [];
  }

  const db = new DatabaseSync(sqlitePath, { readOnly: true });
  try {
    const table = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'jobs'")
      .get();
    if (!table) return [];
    return db.prepare("SELECT * FROM jobs ORDER BY updated_at ASC").all();
  } finally {
    db.close();
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const vrServiceDir = resolve(process.env.VR_SERVICE_DIR || resolveDefaultVrServiceDir());
  const sqlitePath = resolve(
    args.sqlite ||
      process.env.VR_DB_PATH ||
      join(process.env.VR_DATA_ROOT || join(vrServiceDir, "data"), "tasks.sqlite"),
  );
  const rows = readJobs(sqlitePath);

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL || DEFAULT_DATABASE_URL,
    max: 1,
  });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await ensurePostgresSchema(client);
    for (const row of rows) {
      await client.query(
        `INSERT INTO video_replace_jobs
           (job_id, stage, progress, message, error, data, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8)
         ON CONFLICT (job_id) DO UPDATE SET
           stage = excluded.stage,
           progress = excluded.progress,
           message = excluded.message,
           error = excluded.error,
           data = excluded.data,
           updated_at = excluded.updated_at`,
        [
          row.job_id,
          row.stage,
          Number(row.progress) || 0,
          row.message || null,
          row.error || null,
          row.data || "{}",
          row.created_at,
          row.updated_at,
        ],
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {}
    throw error;
  } finally {
    client.release();
    await pool.end();
  }

  console.log(`imported video-replace sqlite jobs: ${rows.length}`);
  console.log(`source: ${sqlitePath}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
