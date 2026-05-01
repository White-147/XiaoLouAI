require("../src/env").loadEnvFiles();

const { Pool } = require("pg");
const { DEFAULT_DATABASE_URL } = require("../src/postgres-store");
const { ensurePostgresSchema } = require("../src/postgres-schema");

async function main() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL || DEFAULT_DATABASE_URL,
    max: 1,
  });

  try {
    const client = await pool.connect();
    try {
      await client.query("CREATE EXTENSION IF NOT EXISTS pgcrypto");
      await client.query("CREATE EXTENSION IF NOT EXISTS citext");
      await ensurePostgresSchema(client);
      console.log("postgres schema ok");
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
