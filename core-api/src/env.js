const { existsSync, mkdirSync, readFileSync, writeFileSync } = require("node:fs");
const { dirname, resolve } = require("node:path");

function stripQuotes(value) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}

function parseEnvFile(filePath) {
  const source = readFileSync(filePath, "utf8");
  const entries = {};

  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const normalized = line.startsWith("export ") ? line.slice(7).trim() : line;
    const separatorIndex = normalized.indexOf("=");
    if (separatorIndex <= 0) continue;

    const key = normalized.slice(0, separatorIndex).trim();
    if (!key) continue;

    const value = normalized.slice(separatorIndex + 1).trim();
    entries[key] = stripQuotes(value);
  }

  return entries;
}

function defaultEnvFiles() {
  const coreApiRoot = resolve(__dirname, "..");
  const repoRoot = resolve(coreApiRoot, "..");
  const frontendRoot = resolve(repoRoot, "XIAOLOU-main");

  const candidates = [
    resolve(coreApiRoot, ".env.local"),
    resolve(coreApiRoot, ".env"),
    resolve(repoRoot, ".env.local"),
    resolve(repoRoot, ".env"),
    resolve(frontendRoot, ".env.local"),
    resolve(frontendRoot, ".env"),
  ];

  return Array.from(new Set(candidates));
}

function loadEnvFiles() {
  const loadedFiles = [];

  for (const filePath of defaultEnvFiles()) {
    if (!existsSync(filePath)) continue;

    const entries = parseEnvFile(filePath);
    for (const [key, value] of Object.entries(entries)) {
      if (process.env[key] === undefined) {
        process.env[key] = value;
      }
    }

    loadedFiles.push(filePath);
  }

  return loadedFiles;
}

function defaultWritableEnvFile() {
  const coreApiRoot = resolve(__dirname, "..");
  return resolve(coreApiRoot, ".env.local");
}

function quoteEnvValue(value) {
  return `"${String(value ?? "").replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function setEnvValue(key, value, filePath = defaultWritableEnvFile()) {
  const normalizedKey = String(key || "").trim();
  if (!normalizedKey) {
    throw new Error("env key is required");
  }

  const nextValue = typeof value === "string" ? value : String(value ?? "");
  const existingContent = existsSync(filePath) ? readFileSync(filePath, "utf8") : "";
  const lines = existingContent ? existingContent.split(/\r?\n/) : [];
  const matcher = new RegExp(`^\\s*(?:export\\s+)?${normalizedKey.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*=`);
  const serialized = `${normalizedKey}=${quoteEnvValue(nextValue)}`;
  let replaced = false;

  const nextLines = lines
    .filter((line, index, array) => !(index === array.length - 1 && line === ""))
    .map((line) => {
      if (!matcher.test(line)) return line;
      replaced = true;
      return serialized;
    });

  if (!replaced) {
    nextLines.push(serialized);
  }

  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${nextLines.join("\n")}\n`, "utf8");
  process.env[normalizedKey] = nextValue;
  return filePath;
}

function unsetEnvValue(key, filePath = defaultWritableEnvFile()) {
  const normalizedKey = String(key || "").trim();
  if (!normalizedKey) {
    throw new Error("env key is required");
  }

  const matcher = new RegExp(`^\\s*(?:export\\s+)?${normalizedKey.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*=`);
  const existingContent = existsSync(filePath) ? readFileSync(filePath, "utf8") : "";
  const lines = existingContent ? existingContent.split(/\r?\n/) : [];
  const nextLines = lines.filter((line, index, array) => {
    if (index === array.length - 1 && line === "") return false;
    return !matcher.test(line);
  });

  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${nextLines.join("\n")}${nextLines.length ? "\n" : ""}`, "utf8");
  delete process.env[normalizedKey];
  return filePath;
}

module.exports = {
  loadEnvFiles,
  setEnvValue,
  unsetEnvValue,
};
