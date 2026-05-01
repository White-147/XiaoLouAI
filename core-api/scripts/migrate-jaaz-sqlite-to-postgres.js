require("../src/env").loadEnvFiles();

const { existsSync } = require("node:fs");
const { DatabaseSync } = require("node:sqlite");
const { join, resolve } = require("node:path");
const { Pool } = require("pg");
const { DEFAULT_DATABASE_URL } = require("../src/postgres-store");
const { checksum, ensurePostgresSchema } = require("../src/postgres-schema");

const TABLES = [
  ["canvases", "jaaz_canvases"],
  ["chat_sessions", "jaaz_chat_sessions"],
  ["chat_messages", "jaaz_chat_messages"],
  ["comfy_workflows", "jaaz_comfy_workflows"],
];

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

function hasTable(db, tableName) {
  return Boolean(
    db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(tableName),
  );
}

function readRows(db, tableName) {
  if (!hasTable(db, tableName)) return [];
  return db.prepare(`SELECT * FROM ${tableName}`).all();
}

async function writeAudit(client, source, entity, sourceCount, targetCount, rows) {
  await client.query(
    `INSERT INTO migration_audit (source, entity, source_count, target_count, checksum)
     VALUES ($1,$2,$3,$4,$5)`,
    [source, entity, sourceCount, targetCount, checksum(rows)],
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const repoRoot = resolve(__dirname, "..", "..");
  const sqlitePath = resolve(
    args.sqlite ||
      process.env.JAAZ_SQLITE_PATH ||
      join(repoRoot, "jaaz", "server", "user_data", "localmanus.db"),
  );

  if (!existsSync(sqlitePath)) {
    console.log(`skip missing jaaz sqlite database: ${sqlitePath}`);
    return;
  }

  const db = new DatabaseSync(sqlitePath, { readOnly: true });
  const rows = Object.fromEntries(TABLES.map(([source]) => [source, readRows(db, source)]));
  db.close();

  const pool = new Pool({
    connectionString: process.env.JAAZ_DATABASE_URL || process.env.DATABASE_URL || DEFAULT_DATABASE_URL,
    max: 1,
  });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await ensurePostgresSchema(client);

    await client.query("DELETE FROM jaaz_chat_messages");
    await client.query("DELETE FROM jaaz_chat_sessions");
    await client.query("DELETE FROM jaaz_comfy_workflows");
    await client.query("DELETE FROM jaaz_canvases");

    for (const row of rows.canvases) {
      await client.query(
        `INSERT INTO jaaz_canvases
           (id, name, data, description, thumbnail, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (id) DO UPDATE SET
           name = EXCLUDED.name,
           data = EXCLUDED.data,
           description = EXCLUDED.description,
           thumbnail = EXCLUDED.thumbnail,
           created_at = EXCLUDED.created_at,
           updated_at = EXCLUDED.updated_at`,
        [
          row.id,
          row.name,
          row.data || null,
          row.description || "",
          row.thumbnail || null,
          row.created_at || new Date().toISOString(),
          row.updated_at || row.created_at || new Date().toISOString(),
        ],
      );
    }

    for (const row of rows.chat_sessions) {
      await client.query(
        `INSERT INTO jaaz_chat_sessions
           (id, canvas_id, title, model, provider, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (id) DO UPDATE SET
           canvas_id = EXCLUDED.canvas_id,
           title = EXCLUDED.title,
           model = EXCLUDED.model,
           provider = EXCLUDED.provider,
           created_at = EXCLUDED.created_at,
           updated_at = EXCLUDED.updated_at`,
        [
          row.id,
          row.canvas_id || null,
          row.title || null,
          row.model || null,
          row.provider || null,
          row.created_at || new Date().toISOString(),
          row.updated_at || row.created_at || new Date().toISOString(),
        ],
      );
    }

    for (const row of rows.chat_messages) {
      await client.query(
        `INSERT INTO jaaz_chat_messages
           (id, session_id, role, message, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (id) DO UPDATE SET
           session_id = EXCLUDED.session_id,
           role = EXCLUDED.role,
           message = EXCLUDED.message,
           created_at = EXCLUDED.created_at,
           updated_at = EXCLUDED.updated_at`,
        [
          row.id,
          row.session_id,
          row.role || "user",
          row.message || null,
          row.created_at || new Date().toISOString(),
          row.updated_at || row.created_at || new Date().toISOString(),
        ],
      );
    }

    for (const row of rows.comfy_workflows) {
      await client.query(
        `INSERT INTO jaaz_comfy_workflows
           (id, name, api_json, description, inputs, outputs, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (id) DO UPDATE SET
           name = EXCLUDED.name,
           api_json = EXCLUDED.api_json,
           description = EXCLUDED.description,
           inputs = EXCLUDED.inputs,
           outputs = EXCLUDED.outputs,
           created_at = EXCLUDED.created_at,
           updated_at = EXCLUDED.updated_at`,
        [
          row.id,
          row.name,
          row.api_json || null,
          row.description || "",
          row.inputs || null,
          row.outputs || null,
          row.created_at || new Date().toISOString(),
          row.updated_at || row.created_at || new Date().toISOString(),
        ],
      );
    }

    await client.query(
      "SELECT setval(pg_get_serial_sequence('jaaz_chat_messages','id'), COALESCE((SELECT MAX(id) FROM jaaz_chat_messages), 1), true)",
    );
    await client.query(
      "SELECT setval(pg_get_serial_sequence('jaaz_comfy_workflows','id'), COALESCE((SELECT MAX(id) FROM jaaz_comfy_workflows), 1), true)",
    );

    for (const [sourceTable, targetTable] of TABLES) {
      const countResult = await client.query(`SELECT COUNT(*)::integer AS count FROM ${targetTable}`);
      await writeAudit(
        client,
        `jaaz-sqlite:${sqlitePath}`,
        targetTable,
        rows[sourceTable].length,
        countResult.rows[0]?.count || 0,
        rows[sourceTable],
      );
    }

    await client.query("COMMIT");

    console.log(`imported jaaz sqlite database: ${sqlitePath}`);
    for (const [sourceTable, targetTable] of TABLES) {
      console.log(`${targetTable}: ${rows[sourceTable].length}`);
    }
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
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
