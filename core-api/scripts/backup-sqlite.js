require("../src/env").loadEnvFiles();

const { copyFileSync, cpSync, existsSync, mkdirSync } = require("node:fs");
const { basename, resolve } = require("node:path");

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function copyIfExists(source, targetDir) {
  if (!existsSync(source)) {
    console.log(`skip missing: ${source}`);
    return;
  }

  const target = resolve(targetDir, basename(source));
  copyFileSync(source, target);
  console.log(`copied ${source} -> ${target}`);
}

function copyDirectoryIfExists(source, targetDir) {
  if (!existsSync(source)) {
    console.log(`skip missing: ${source}`);
    return;
  }

  const target = resolve(targetDir, basename(source));
  cpSync(source, target, { recursive: true });
  console.log(`copied ${source} -> ${target}`);
}

function main() {
  const repoRoot = resolve(__dirname, "..", "..");
  const coreRoot = resolve(__dirname, "..");
  const backupDir = resolve(coreRoot, "backup", `sqlite-${timestamp()}`);
  mkdirSync(backupDir, { recursive: true });

  copyIfExists(
    resolve(process.env.CORE_API_DB_PATH || resolve(coreRoot, "data", "demo.sqlite")),
    backupDir,
  );
  copyIfExists(resolve(repoRoot, "video-replace-service", "data", "tasks.sqlite"), backupDir);
  copyIfExists(resolve(repoRoot, "jaaz", "server", "user_data", "localmanus.db"), backupDir);
  copyIfExists(resolve(coreRoot, ".env.local"), backupDir);
  copyDirectoryIfExists(resolve(process.env.CORE_API_UPLOAD_DIR || resolve(coreRoot, "uploads")), backupDir);

  console.log(`backup complete: ${backupDir}`);
}

main();
