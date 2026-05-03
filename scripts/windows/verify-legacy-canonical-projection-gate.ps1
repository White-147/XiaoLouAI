param(
  [string]$RepoRoot = "",
  [string]$EnvFile = "$PSScriptRoot\.env.windows",
  [string]$NodeExe = "",
  [string]$DatabaseUrl = "",
  [string]$ReportDir = "",
  [string]$SchemaName = ""
)

$ErrorActionPreference = "Stop"

if (-not $RepoRoot) {
  $RepoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..\..")).Path
}

if (-not (Test-Path -LiteralPath $EnvFile)) {
  $runtimeEnvFile = Join-Path $RepoRoot ".runtime\app\scripts\windows\.env.windows"
  if (Test-Path -LiteralPath $runtimeEnvFile) {
    $EnvFile = $runtimeEnvFile
  }
}

. "$PSScriptRoot\load-env.ps1" -EnvFile $EnvFile

function Resolve-DTool {
  param(
    [string]$Provided,
    [string]$EnvName,
    [string]$DefaultPath,
    [string]$Name
  )

  $value = $Provided
  if (-not $value) {
    $value = [Environment]::GetEnvironmentVariable($EnvName, "Process")
  }
  if (-not $value) {
    $value = $DefaultPath
  }

  if (-not (Test-Path -LiteralPath $value)) {
    throw "$Name not found at $value"
  }

  $full = [System.IO.Path]::GetFullPath($value)
  if (-not $full.StartsWith("D:\", [StringComparison]::OrdinalIgnoreCase)) {
    throw "$Name must use the D: runtime path. Refusing $full"
  }

  return $full
}

function Add-SearchPathToDatabaseUrl {
  param(
    [string]$Url,
    [string]$Schema
  )

  $separator = if ($Url.Contains("?")) { "&" } else { "?" }
  return "$Url${separator}options=-c%20search_path%3D$Schema"
}

$NodeExe = Resolve-DTool $NodeExe "NODE_EXE" "D:\soft\program\nodejs\node.exe" "Node.js"
$CoreApiRoot = Join-Path $RepoRoot "core-api"
if (-not (Test-Path -LiteralPath (Join-Path $CoreApiRoot "scripts\project-legacy-to-canonical.js"))) {
  throw "core-api projector not found under $CoreApiRoot"
}

if (-not $DatabaseUrl) {
  $DatabaseUrl = [Environment]::GetEnvironmentVariable("DATABASE_URL", "Process")
}
if (-not $DatabaseUrl -or $DatabaseUrl.Contains("change-me")) {
  $DatabaseUrl = "postgres://root:root@127.0.0.1:5432/xiaolou_windows_native_test"
}

if (-not $ReportDir) {
  $ReportDir = [Environment]::GetEnvironmentVariable("LOG_DIR", "Process")
}
if (-not $ReportDir) {
  $ReportDir = Join-Path $RepoRoot ".runtime\xiaolou-logs"
}
New-Item -ItemType Directory -Force -Path $ReportDir | Out-Null

if (-not $SchemaName) {
  $SchemaName = "legacy_projection_staging_$(Get-Date -Format "yyyyMMdd_HHmmss")_provider_video"
}
if ($SchemaName -notmatch '^legacy_projection_staging_[a-zA-Z0-9_]+$') {
  throw "Projection fixture schema must start with legacy_projection_staging_ and contain only letters, numbers, and underscores. Got $SchemaName"
}

$tempDir = Join-Path $RepoRoot ".runtime\xiaolou-temp"
New-Item -ItemType Directory -Force -Path $tempDir | Out-Null
$seedPath = Join-Path $tempDir "seed-legacy-projection-fixture-$SchemaName.js"

$seedJs = @'
const path = require("node:path");
const { createHash } = require("node:crypto");

const coreApiRoot = process.env.PROJECTION_FIXTURE_CORE_API_ROOT;
const schema = process.env.PROJECTION_FIXTURE_SCHEMA;
const databaseUrl = process.env.PROJECTION_FIXTURE_DATABASE_URL;
if (!coreApiRoot || !schema || !databaseUrl) {
  throw new Error("PROJECTION_FIXTURE_CORE_API_ROOT, PROJECTION_FIXTURE_SCHEMA, and PROJECTION_FIXTURE_DATABASE_URL are required.");
}
if (!/^legacy_projection_staging_[a-zA-Z0-9_]+$/.test(schema)) {
  throw new Error(`Unsafe fixture schema: ${schema}`);
}

const { Pool } = require(require.resolve("pg", { paths: [coreApiRoot] }));
const { ensurePostgresSchema } = require(path.join(coreApiRoot, "src/postgres-schema"));

(async () => {
  process.env.CORE_API_COMPAT_READ_ONLY = "0";
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  const client = await pool.connect();
  try {
    await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await client.query(`CREATE SCHEMA ${schema}`);
    await client.query(`SET search_path TO ${schema}`);
    await ensurePostgresSchema(client);
    await client.query(`CREATE TABLE IF NOT EXISTS provider_jobs (
      id text PRIMARY KEY,
      actor_id text,
      wallet_id text,
      status text,
      provider text,
      model text,
      data jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at text,
      updated_at text
    )`);

    const snapshot = {
      users: [{ id: "legacy_user_provider_video", email: "provider-video@example.test", displayName: "Provider Video" }],
      wallets: [{ id: "legacy_wallet_provider_video", ownerType: "user", ownerId: "legacy_user_provider_video" }],
      tasks: [],
    };
    const checksum = createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");
    await client.query(
      `INSERT INTO legacy_state_snapshot (snapshot_key, snapshot_value, snapshot_checksum) VALUES ('snapshot', $1::jsonb, $2)`,
      [JSON.stringify(snapshot), checksum],
    );
    await client.query(
      `INSERT INTO users (id, email, display_name, data, created_at, updated_at) VALUES ($1,$2,$3,$4::jsonb,$5,$5)`,
      ["legacy_user_provider_video", "provider-video@example.test", "Provider Video", JSON.stringify({ id: "legacy_user_provider_video" }), "2026-05-02T08:09:00.000Z"],
    );
    await client.query(
      `INSERT INTO wallets (id, owner_type, owner_id, data, created_at, updated_at) VALUES ($1,'user',$2,$3::jsonb,$4,$4)`,
      ["legacy_wallet_provider_video", "legacy_user_provider_video", JSON.stringify({ id: "legacy_wallet_provider_video", ownerType: "user", ownerId: "legacy_user_provider_video" }), "2026-05-02T08:09:00.000Z"],
    );
    await client.query(
      `INSERT INTO provider_jobs (id, actor_id, wallet_id, status, provider, model, data, created_at, updated_at)
       VALUES ($1,$2,$3,'running','closed-provider','model-x',$4::jsonb,$5,$5)`,
      ["provider_job_active_001", "legacy_user_provider_video", "legacy_wallet_provider_video", JSON.stringify({
        id: "provider_job_active_001",
        actorId: "legacy_user_provider_video",
        walletId: "legacy_wallet_provider_video",
        provider: "closed-provider",
        model: "model-x",
      }), "2026-05-02T08:09:01.000Z"],
    );
    await client.query(
      `INSERT INTO video_replace_jobs (job_id, legacy_id, stage, progress, message, error, data, created_at, updated_at)
       VALUES ($1::uuid,$2,'running',25,'working',null,$3::jsonb,$4,$4)`,
      ["11111111-1111-4111-8111-111111111111", "video_replace_active_001", JSON.stringify({
        id: "video_replace_active_001",
        actorId: "legacy_user_provider_video",
        walletId: "legacy_wallet_provider_video",
        prompt: "replace video synthetic",
      }), "2026-05-02T08:09:02.000Z"],
    );
    await client.query(
      `INSERT INTO projects (id, title, summary, status, data, created_at, updated_at)
       VALUES ($1,'Legacy adjacent fixture','Projection fixture','active',$2::jsonb,$3,$3)
       ON CONFLICT (id) DO UPDATE SET data = projects.data || excluded.data, updated_at = excluded.updated_at`,
      ["legacy_project_adjacent_001", JSON.stringify({ legacyProjectionFixture: true }), "2026-05-02T08:09:03.000Z"],
    );
    await client.query(`CREATE TABLE IF NOT EXISTS storyboards (
      id text PRIMARY KEY,
      project_id text,
      shot_no integer,
      title text,
      image_status text,
      video_status text,
      data jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at text,
      updated_at text
    )`);
    await client.query(`CREATE TABLE IF NOT EXISTS videos (
      id text PRIMARY KEY,
      project_id text,
      storyboard_id text,
      status text,
      video_url text,
      data jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at text,
      updated_at text
    )`);
    await client.query(`CREATE TABLE IF NOT EXISTS dubbings (
      id text PRIMARY KEY,
      project_id text,
      storyboard_id text,
      status text,
      audio_url text,
      data jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at text,
      updated_at text
    )`);
    await client.query(
      `INSERT INTO storyboards (id, project_id, shot_no, title, image_status, video_status, data, created_at, updated_at)
       VALUES ($1,$2,1,'Opening','ready','pending',$3::jsonb,$4,$4)`,
      ["legacy_storyboard_001", "legacy_project_adjacent_001", JSON.stringify({
        title: "Opening",
        script: "Opening shot",
        imageStatus: "ready",
        videoStatus: "pending",
        promptSummary: "Opening",
        imageUrl: "https://example.test/storyboard.png",
      }), "2026-05-02T08:09:04.000Z"],
    );
    await client.query(
      `INSERT INTO project_storyboards (
        id, project_id, shot_no, episode_no, title, script, image_status,
        video_status, duration_seconds, prompt_summary, image_url, data, created_at, updated_at
      ) VALUES ($1,$2,1,1,'Opening','Opening shot','ready','pending',3,'Opening',$3,$4::jsonb,$5,$5)`,
      ["legacy_storyboard_001", "legacy_project_adjacent_001", "https://example.test/storyboard.png", JSON.stringify({
        title: "Opening",
        script: "Opening shot",
        imageStatus: "ready",
        videoStatus: "pending",
        promptSummary: "Opening",
        imageUrl: "https://example.test/storyboard.png",
      }), "2026-05-02T08:09:04.000Z"],
    );
    await client.query(
      `INSERT INTO videos (id, project_id, storyboard_id, status, video_url, data, created_at, updated_at)
       VALUES ($1,$2,$3,'ready',$4,$5::jsonb,$6,$6)`,
      ["legacy_video_001", "legacy_project_adjacent_001", "legacy_storyboard_001", "https://example.test/video.mp4", JSON.stringify({
        storyboardId: "legacy_storyboard_001",
        status: "ready",
        videoUrl: "https://example.test/video.mp4",
        thumbnailUrl: "https://example.test/video.jpg",
      }), "2026-05-02T08:09:05.000Z"],
    );
    await client.query(
      `INSERT INTO project_videos (
        id, project_id, storyboard_id, version, status, duration_seconds,
        video_url, thumbnail_url, data, created_at, updated_at
      ) VALUES ($1,$2,$3,1,'ready',3,$4,$5,$6::jsonb,$7,$7)`,
      ["legacy_video_001", "legacy_project_adjacent_001", "legacy_storyboard_001", "https://example.test/video.mp4", "https://example.test/video.jpg", JSON.stringify({
        storyboardId: "legacy_storyboard_001",
        status: "ready",
        videoUrl: "https://example.test/video.mp4",
        thumbnailUrl: "https://example.test/video.jpg",
      }), "2026-05-02T08:09:05.000Z"],
    );
    await client.query(
      `INSERT INTO dubbings (id, project_id, storyboard_id, status, audio_url, data, created_at, updated_at)
       VALUES ($1,$2,$3,'ready',$4,$5::jsonb,$6,$6)`,
      ["legacy_dubbing_001", "legacy_project_adjacent_001", "legacy_storyboard_001", "https://example.test/audio.wav", JSON.stringify({
        storyboardId: "legacy_storyboard_001",
        speakerName: "Narrator",
        voicePreset: "calm",
        text: "Opening narration",
        status: "ready",
        audioUrl: "https://example.test/audio.wav",
      }), "2026-05-02T08:09:06.000Z"],
    );
    await client.query(
      `INSERT INTO project_dubbings (
        id, project_id, storyboard_id, speaker_name, voice_preset,
        text_content, status, audio_url, data, created_at, updated_at
      ) VALUES ($1,$2,$3,'Narrator','calm','Opening narration','ready',$4,$5::jsonb,$6,$6)`,
      ["legacy_dubbing_001", "legacy_project_adjacent_001", "legacy_storyboard_001", "https://example.test/audio.wav", JSON.stringify({
        storyboardId: "legacy_storyboard_001",
        speakerName: "Narrator",
        voicePreset: "calm",
        text: "Opening narration",
        status: "ready",
        audioUrl: "https://example.test/audio.wav",
      }), "2026-05-02T08:09:06.000Z"],
    );
    await client.query(
      `INSERT INTO project_assets (
        id, project_id, asset_type, name, preview_url, media_kind, media_url, data, created_at, updated_at
      ) VALUES ($1,$2,'image_ref','Fixture asset',$3,'image',$3,$4::jsonb,$5,$5)`,
      ["legacy_asset_001", "legacy_project_adjacent_001", "https://example.test/asset.png", JSON.stringify({
        assetType: "image_ref",
        name: "Fixture asset",
        previewUrl: "https://example.test/asset.png",
        mediaKind: "image",
        mediaUrl: "https://example.test/asset.png",
      }), "2026-05-02T08:09:07.000Z"],
    );
    console.log(JSON.stringify({ schema, status: "seeded" }));
  } finally {
    client.release();
    await pool.end();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
'@

Set-Content -LiteralPath $seedPath -Value $seedJs -Encoding UTF8

$env:PROJECTION_FIXTURE_CORE_API_ROOT = $CoreApiRoot
$env:PROJECTION_FIXTURE_SCHEMA = $SchemaName
$env:PROJECTION_FIXTURE_DATABASE_URL = $DatabaseUrl
& $NodeExe $seedPath
if ($LASTEXITCODE -ne 0) {
  throw "Projection gate fixture seed failed with exit code $LASTEXITCODE"
}

$schemaDatabaseUrl = Add-SearchPathToDatabaseUrl $DatabaseUrl $SchemaName
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$projectReport = Join-Path $ReportDir "legacy-canonical-project-gate-fixture-$stamp.json"
$verifyReport = Join-Path $ReportDir "legacy-canonical-projection-gate-fixture-$stamp.json"

& "$PSScriptRoot\project-legacy-to-canonical.ps1" `
  -RepoRoot $RepoRoot `
  -EnvFile $EnvFile `
  -NodeExe $NodeExe `
  -DatabaseUrl $schemaDatabaseUrl `
  -Execute `
  -ReportPath $projectReport
if ($LASTEXITCODE -ne 0) {
  throw "Projection gate fixture project failed with exit code $LASTEXITCODE"
}

& "$PSScriptRoot\verify-legacy-canonical-projection.ps1" `
  -RepoRoot $RepoRoot `
  -EnvFile $EnvFile `
  -NodeExe $NodeExe `
  -DatabaseUrl $schemaDatabaseUrl `
  -LegacyWritesFrozen `
  -ReportPath $verifyReport
if ($LASTEXITCODE -ne 0) {
  throw "Projection gate fixture verify failed with exit code $LASTEXITCODE"
}

@{
  status = "ok"
  schema = $SchemaName
  projectReport = $projectReport
  verifyReport = $verifyReport
} | ConvertTo-Json -Depth 5
