const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");

const WINDOWS_NATIVE_SCHEMA_SQL = readFileSync(
  resolve(__dirname, "..", "db", "migrations", "20260501_windows_native_core.sql"),
  "utf8",
);

async function ensureWindowsNativeSchema(client) {
  await client.query(WINDOWS_NATIVE_SCHEMA_SQL);
}

module.exports = {
  ensureWindowsNativeSchema,
  WINDOWS_NATIVE_SCHEMA_SQL,
};
