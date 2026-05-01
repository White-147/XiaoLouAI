require("../src/env").loadEnvFiles();

const { resolve } = require("node:path");
const { Pool } = require("pg");
const { setEnvValue } = require("../src/env");
const { DEFAULT_DATABASE_URL } = require("../src/postgres-store");

const DEFAULT_PUBLIC_DATABASE_URL = "postgres://root:root@218.92.180.214:5432/xiaolou";

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--database-url" || arg === "--url") {
      args.databaseUrl = argv[index + 1];
      index += 1;
    } else if (arg === "--public-url") {
      args.publicUrl = argv[index + 1];
      index += 1;
    } else if (arg === "--use-public") {
      args.usePublic = true;
    } else if (arg === "--dry-run") {
      args.dryRun = true;
    }
  }
  return args;
}

async function assertImportedSnapshot(databaseUrl) {
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  try {
    const snapshotResult = await pool.query(
      `SELECT snapshot_checksum, updated_at
       FROM legacy_state_snapshot
       WHERE snapshot_key = $1
       LIMIT 1`,
      ["snapshot"],
    );
    const row = snapshotResult.rows[0];
    if (!row) {
      throw new Error("legacy_state_snapshot has no snapshot row; run npm run db:import-sqlite first");
    }
    const vrResult = await pool.query("SELECT COUNT(*)::integer AS count FROM video_replace_jobs");
    const jaazResult = await pool.query("SELECT COUNT(*)::integer AS count FROM jaaz_canvases");
    return {
      ...row,
      videoReplaceJobCount: vrResult.rows[0]?.count ?? 0,
      jaazCanvasCount: jaazResult.rows[0]?.count ?? 0,
    };
  } finally {
    await pool.end();
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const publicUrl = args.publicUrl || process.env.DATABASE_PUBLIC_URL || DEFAULT_PUBLIC_DATABASE_URL;
  const localUrl = args.databaseUrl || process.env.DATABASE_URL || DEFAULT_DATABASE_URL;
  const databaseUrl = args.usePublic ? publicUrl : localUrl;

  const snapshot = await assertImportedSnapshot(databaseUrl);
  const envPath = resolve(__dirname, "..", ".env.local");

  if (!args.dryRun) {
    setEnvValue("DATABASE_URL", databaseUrl, envPath);
    setEnvValue("DATABASE_PUBLIC_URL", publicUrl, envPath);
    setEnvValue("VR_DATABASE_URL", databaseUrl, envPath);
    setEnvValue("JAAZ_DATABASE_URL", databaseUrl, envPath);
    setEnvValue("PGPOOL_MAX", process.env.PGPOOL_MAX || "10", envPath);
    setEnvValue("PGSSL_MODE", process.env.PGSSL_MODE || "disable", envPath);
    setEnvValue("POSTGRES_ALLOW_EMPTY_BOOTSTRAP", "0", envPath);
  }

  console.log(`postgres cutover ${args.dryRun ? "dry run ok" : "ok"}`);
  console.log(`env file: ${envPath}`);
  console.log(`runtime DATABASE_URL: ${databaseUrl}`);
  console.log(`public DATABASE_PUBLIC_URL: ${publicUrl}`);
  console.log(`snapshot checksum: ${snapshot.snapshot_checksum}`);
  console.log(`snapshot updated_at: ${snapshot.updated_at}`);
  console.log(`video_replace_jobs: ${snapshot.videoReplaceJobCount}`);
  console.log(`jaaz_canvases: ${snapshot.jaazCanvasCount}`);
  console.log("Restart core-api after this step. SQLite remains only as a migration backup/source.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
