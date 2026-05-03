require("../src/env").loadEnvFiles();

const { mkdirSync, writeFileSync } = require("node:fs");
const { dirname, resolve } = require("node:path");
const { Pool } = require("pg");
const { DEFAULT_DATABASE_URL } = require("../src/postgres-store");
const { projectSnapshot } = require("../src/postgres-schema");

const TERMINAL_STATUSES = [
  "succeeded",
  "success",
  "failed",
  "cancelled",
  "canceled",
  "completed",
  "done",
  "paid",
  "processed",
];

const REQUIRED_CANONICAL_TABLES = [
  "accounts",
  "users",
  "organizations",
  "organization_memberships",
  "api_center_configs",
  "jobs",
  "job_attempts",
  "payment_orders",
  "payment_callbacks",
  "wallet_ledger",
  "wallet_balances",
  "media_objects",
  "project_assets",
  "project_storyboards",
  "project_videos",
  "project_dubbings",
  "project_exports",
  "toolbox_capabilities",
  "toolbox_runs",
  "pricing_rules",
  "enterprise_applications",
  "outbox_events",
  "provider_health",
];

const LEGACY_SOURCE_TABLES = [
  "tasks",
  "provider_jobs",
  "video_replace_jobs",
  "wallet_recharge_orders",
  "payment_events",
  "wallets",
  "wallet_ledger",
  "project_assets",
  "storyboards",
  "videos",
  "dubbings",
  "create_studio_images",
  "create_studio_videos",
];

function parseArgs(argv) {
  const args = {
    snapshotKey: "snapshot",
    strict: false,
    allowMissingLegacy: false,
    legacyWritesFrozen: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--database-url" || arg === "--url") {
      args.databaseUrl = argv[index + 1];
      index += 1;
    } else if (arg === "--snapshot-key") {
      args.snapshotKey = argv[index + 1];
      index += 1;
    } else if (arg === "--report-path") {
      args.reportPath = argv[index + 1];
      index += 1;
    } else if (arg === "--strict") {
      args.strict = true;
    } else if (arg === "--allow-missing-legacy") {
      args.allowMissingLegacy = true;
    } else if (arg === "--legacy-writes-frozen" || arg === "--legacy-writers-frozen") {
      args.legacyWritesFrozen = true;
    }
  }

  return args;
}

function redactDatabaseUrl(value) {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.password) url.password = "***";
    return url.toString();
  } catch {
    return value.replace(/:\/\/([^:\s]+):([^@\s]+)@/, "://$1:***@");
  }
}

function countRows(rows) {
  return Number(rows?.[0]?.count || 0);
}

function toCountMap(projections) {
  return Object.fromEntries(
    Object.entries(projections || {}).map(([entity, rows]) => [entity, Array.isArray(rows) ? rows.length : 0]),
  );
}

function normalizeStatusSql(columnName) {
  const values = TERMINAL_STATUSES.map((status) => `'${status}'`).join(",");
  return `lower(coalesce(${columnName}::text, '')) not in (${values})`;
}

function addFinding(findings, severity, code, message, details = {}) {
  findings.push({ severity, code, message, details });
}

function isStagedProviderHealthStatus(status) {
  const normalized = normalizeIdentifier(status) || "unknown";
  return ["evidence_pending", "pending", "unknown", "not_checked"].includes(normalized);
}

async function tableExists(client, tableName) {
  const result = await client.query(
    `SELECT EXISTS (
       SELECT 1
       FROM information_schema.tables
       WHERE table_schema = current_schema()
         AND table_name = $1
     ) AS exists`,
    [tableName],
  );
  return Boolean(result.rows[0]?.exists);
}

async function getColumns(client, tableName) {
  const result = await client.query(
    `SELECT column_name, data_type
     FROM information_schema.columns
     WHERE table_schema = current_schema()
       AND table_name = $1`,
    [tableName],
  );
  return new Map(result.rows.map((row) => [row.column_name, row.data_type]));
}

async function queryCount(client, tableName, whereSql = "true") {
  const exists = await tableExists(client, tableName);
  if (!exists) return null;
  const result = await client.query(`SELECT count(*)::integer AS count FROM ${tableName} WHERE ${whereSql}`);
  return countRows(result.rows);
}

async function queryCountIfColumns(client, tableName, requiredColumns, whereSql = "true") {
  const exists = await tableExists(client, tableName);
  if (!exists) return null;
  const columns = await getColumns(client, tableName);
  for (const columnName of requiredColumns) {
    if (!columns.has(columnName)) return null;
  }
  const result = await client.query(`SELECT count(*)::integer AS count FROM ${tableName} WHERE ${whereSql}`);
  return countRows(result.rows);
}

async function queryCountIfReady(client, tableRequirements, fromSql, whereSql = "true") {
  for (const [tableName, requiredColumns] of Object.entries(tableRequirements)) {
    const exists = await tableExists(client, tableName);
    if (!exists) return null;
    const columns = await getColumns(client, tableName);
    for (const columnName of requiredColumns) {
      if (!columns.has(columnName)) return null;
    }
  }
  const result = await client.query(`SELECT count(*)::integer AS count FROM ${fromSql} WHERE ${whereSql}`);
  return countRows(result.rows);
}

function numeric(value) {
  return value === null || value === undefined ? 0 : Number(value);
}

function sumCounts(...values) {
  return values.reduce((total, value) => total + numeric(value), 0);
}

function sumObjectValues(value) {
  if (!value || typeof value !== "object") return 0;
  return Object.values(value).reduce((total, item) => total + numeric(item), 0);
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function normalizeIdentifier(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeSecretKey(value) {
  return String(value || "").toLowerCase().replace(/[\s_-]/g, "");
}

function collectRawSecretFieldPaths(value, path = "$", paths = []) {
  const rawSecretKeys = new Set([
    "apikey",
    "accesskey",
    "accesstoken",
    "token",
    "secret",
    "secretkey",
    "privatekey",
    "password",
    "webhooksecret",
  ]);

  if (Array.isArray(value)) {
    value.forEach((item, index) => collectRawSecretFieldPaths(item, `${path}[${index}]`, paths));
    return paths;
  }

  if (!asObject(value)) {
    return paths;
  }

  for (const [key, child] of Object.entries(value)) {
    const childPath = `${path}.${key}`;
    const normalizedKey = normalizeSecretKey(key);
    const hasSecretValue = child !== null
      && child !== undefined
      && child !== ""
      && typeof child !== "boolean";
    if (rawSecretKeys.has(normalizedKey) && hasSecretValue) {
      paths.push(childPath);
      continue;
    }

    collectRawSecretFieldPaths(child, childPath, paths);
  }

  return paths;
}

async function readSnapshotProjection(client, snapshotKey) {
  const exists = await tableExists(client, "legacy_state_snapshot");
  if (!exists) {
    return { present: false, reason: "legacy_state_snapshot table missing" };
  }

  const result = await client.query(
    `SELECT snapshot_value, snapshot_checksum, updated_at
     FROM legacy_state_snapshot
     WHERE snapshot_key = $1
     LIMIT 1`,
    [snapshotKey],
  );
  const row = result.rows[0];
  if (!row) {
    return { present: false, reason: `snapshot key '${snapshotKey}' missing` };
  }

  const projections = projectSnapshot(row.snapshot_value);
  return {
    present: true,
    checksum: row.snapshot_checksum,
    updatedAt: row.updated_at,
    projectionCounts: toCountMap(projections),
  };
}

async function readLegacySqlSources(client) {
  const sources = {};
  for (const tableName of LEGACY_SOURCE_TABLES) {
    const exists = await tableExists(client, tableName);
    if (!exists) {
      sources[tableName] = { exists: false, count: null };
      continue;
    }

    const columns = await getColumns(client, tableName);
    sources[tableName] = {
      exists: true,
      count: await queryCount(client, tableName),
      columns: Array.from(columns.keys()).sort(),
    };

    if (columns.has("status")) {
      sources[tableName].activeCount = await queryCount(
        client,
        tableName,
        normalizeStatusSql("status"),
      );
      sources[tableName].paidOrSucceededCount = await queryCount(
        client,
        tableName,
        "lower(coalesce(status::text, '')) in ('paid','success','succeeded','completed','confirmed')",
      );
    }
    if (columns.has("stage")) {
      sources[tableName].activeCount = await queryCount(
        client,
        tableName,
        normalizeStatusSql("stage"),
      );
    }
    if (columns.has("verified")) {
      sources[tableName].verifiedCount = await queryCount(client, tableName, "verified = true");
    }
  }
  return sources;
}

async function readCanonicalTargets(client) {
  const targets = {};
  for (const tableName of REQUIRED_CANONICAL_TABLES) {
    const exists = await tableExists(client, tableName);
    targets[tableName] = {
      exists,
      count: exists ? await queryCount(client, tableName) : null,
      columns: exists ? Array.from((await getColumns(client, tableName)).keys()).sort() : [],
    };
  }

  targets.accounts.withLegacyOwner = await queryCountIfColumns(
    client,
    "accounts",
    ["legacy_owner_type", "legacy_owner_id"],
    "legacy_owner_type IS NOT NULL AND legacy_owner_id IS NOT NULL",
  );
  targets.jobs.withLegacyPayload = await queryCountIfColumns(
    client,
    "jobs",
    ["payload", "idempotency_key"],
    [
      "payload ? 'legacyTaskId'",
      "payload ? 'legacy_task_id'",
      "payload ? 'providerJobId'",
      "payload ? 'provider_job_id'",
      "payload ? 'legacyProviderJobId'",
      "payload ? 'videoReplaceJobId'",
      "payload ? 'legacyVideoReplaceJobId'",
      "coalesce(idempotency_key, '') like 'legacy:task:%'",
      "coalesce(idempotency_key, '') like 'legacy:provider-job:%'",
      "coalesce(idempotency_key, '') like 'legacy:video-replace-job:%'",
    ].join(" OR "),
  );
  targets.jobs.withLegacyTaskPayload = await queryCountIfColumns(
    client,
    "jobs",
    ["payload", "idempotency_key"],
    [
      "payload ? 'legacyTaskId'",
      "payload ? 'legacy_task_id'",
      "coalesce(idempotency_key, '') like 'legacy:task:%'",
    ].join(" OR "),
  );
  targets.jobs.withLegacyProviderJobPayload = await queryCountIfColumns(
    client,
    "jobs",
    ["payload", "idempotency_key"],
    [
      "payload ? 'providerJobId'",
      "payload ? 'provider_job_id'",
      "payload ? 'legacyProviderJobId'",
      "coalesce(idempotency_key, '') like 'legacy:provider-job:%'",
    ].join(" OR "),
  );
  targets.jobs.withLegacyVideoReplacePayload = await queryCountIfColumns(
    client,
    "jobs",
    ["payload", "idempotency_key"],
    [
      "payload ? 'videoReplaceJobId'",
      "payload ? 'legacyVideoReplaceJobId'",
      "payload ? 'video_replace_job_id'",
      "coalesce(idempotency_key, '') like 'legacy:video-replace-job:%'",
    ].join(" OR "),
  );
  targets.jobs.activeCount = await queryCountIfColumns(
    client,
    "jobs",
    ["status"],
    normalizeStatusSql("status"),
  );
  targets.payment_orders.withLegacyRechargeOrder = await queryCountIfColumns(
    client,
    "payment_orders",
    ["legacy_recharge_order_id"],
    "legacy_recharge_order_id IS NOT NULL",
  );
  targets.payment_callbacks.validProcessed = await queryCountIfColumns(
    client,
    "payment_callbacks",
    ["signature_valid", "processing_status"],
    "signature_valid = true AND lower(coalesce(processing_status::text, '')) in ('processed','duplicate','accepted','succeeded')",
  );
  targets.wallet_ledger.canonicalRows = await queryCountIfColumns(
    client,
    "wallet_ledger",
    ["account_id", "idempotency_key", "immutable"],
    "account_id IS NOT NULL AND idempotency_key IS NOT NULL AND immutable = true",
  );
  targets.wallet_ledger.missingCanonicalFields = await queryCountIfColumns(
    client,
    "wallet_ledger",
    ["account_id", "currency", "idempotency_key", "immutable"],
    "account_id IS NULL OR currency IS NULL OR idempotency_key IS NULL OR immutable <> true",
  );
  targets.media_objects.withLegacyPayload = await queryCountIfColumns(
    client,
    "media_objects",
    ["data"],
    [
      "data ? 'legacyAssetId'",
      "data ? 'legacy_asset_id'",
      "data ? 'legacyVideoId'",
      "data ? 'legacyDubbingId'",
      "data ? 'sourceUrl'",
      "data ? 'legacyProjection'",
    ].join(" OR "),
  );
  targets.media_objects.permanentLegacyRows = await queryCountIfColumns(
    client,
    "media_objects",
    ["data", "status", "permanent_object_key"],
    [
      "status = 'permanent'",
      "permanent_object_key IS NOT NULL",
      `(${
        [
        "data ? 'legacyAssetId'",
        "data ? 'legacy_asset_id'",
        "data ? 'legacyVideoId'",
        "data ? 'legacyDubbingId'",
        "data ? 'sourceUrl'",
        "data ? 'legacyProjection'",
        ].join(" OR ")
      })`,
    ].join(" AND "),
  );

  return targets;
}

async function readProjectAdjacentHealth(client) {
  const nonBlank = (column) => `${column} IS NOT NULL AND btrim(${column}::text) <> ''`;
  const missing = (column) => `${column} IS NULL OR btrim(${column}::text) = ''`;
  const jsonConflict = (column, ...keys) => {
    const dataValue = `nullif(coalesce(${keys.map((key) => `data->>'${key}'`).join(", ")}), '')`;
    return `data IS NOT NULL AND ${dataValue} IS NOT NULL AND nullif(${column}, '') IS NOT NULL AND ${column} <> ${dataValue}`;
  };

  const legacySources = {
    storyboards: {
      exists: await tableExists(client, "storyboards"),
      withProjectId: await queryCountIfColumns(client, "storyboards", ["project_id"], nonBlank("project_id")),
      missingProjectId: await queryCountIfColumns(client, "storyboards", ["project_id"], missing("project_id")),
      unprojected: await queryCountIfReady(
        client,
        { storyboards: ["id", "project_id"], project_storyboards: ["id"] },
        "storyboards s LEFT JOIN project_storyboards ps ON ps.id = s.id",
        `s.project_id IS NOT NULL AND btrim(s.project_id::text) <> '' AND ps.id IS NULL`,
      ),
    },
    videos: {
      exists: await tableExists(client, "videos"),
      withProjectId: await queryCountIfColumns(client, "videos", ["project_id"], nonBlank("project_id")),
      missingProjectId: await queryCountIfColumns(client, "videos", ["project_id"], missing("project_id")),
      unprojected: await queryCountIfReady(
        client,
        { videos: ["id", "project_id"], project_videos: ["id"] },
        "videos v LEFT JOIN project_videos pv ON pv.id = v.id",
        `v.project_id IS NOT NULL AND btrim(v.project_id::text) <> '' AND pv.id IS NULL`,
      ),
    },
    dubbings: {
      exists: await tableExists(client, "dubbings"),
      withProjectId: await queryCountIfColumns(client, "dubbings", ["project_id"], nonBlank("project_id")),
      missingProjectId: await queryCountIfColumns(client, "dubbings", ["project_id"], missing("project_id")),
      unprojected: await queryCountIfReady(
        client,
        { dubbings: ["id", "project_id"], project_dubbings: ["id"] },
        "dubbings d LEFT JOIN project_dubbings pd ON pd.id = d.id",
        `d.project_id IS NOT NULL AND btrim(d.project_id::text) <> '' AND pd.id IS NULL`,
      ),
    },
  };

  const canonicalTargets = {
    project_assets: {
      missingProjectId: await queryCountIfColumns(client, "project_assets", ["project_id"], missing("project_id")),
      missingData: await queryCountIfColumns(client, "project_assets", ["data"], "data IS NULL"),
      orphanProjects: await queryCountIfReady(
        client,
        { project_assets: ["project_id"], projects: ["id"] },
        "project_assets pa LEFT JOIN projects p ON p.id = pa.project_id",
        `pa.project_id IS NOT NULL AND btrim(pa.project_id::text) <> '' AND p.id IS NULL`,
      ),
      jsonConflicts: {
        assetType: await queryCountIfColumns(client, "project_assets", ["data", "asset_type"], jsonConflict("asset_type", "assetType", "asset_type")),
        previewUrl: await queryCountIfColumns(client, "project_assets", ["data", "preview_url"], jsonConflict("preview_url", "previewUrl", "preview_url")),
        mediaKind: await queryCountIfColumns(client, "project_assets", ["data", "media_kind"], jsonConflict("media_kind", "mediaKind", "media_kind")),
        mediaUrl: await queryCountIfColumns(client, "project_assets", ["data", "media_url"], jsonConflict("media_url", "mediaUrl", "media_url", "url")),
        generationPrompt: await queryCountIfColumns(client, "project_assets", ["data", "generation_prompt"], jsonConflict("generation_prompt", "generationPrompt", "generation_prompt")),
      },
    },
    project_storyboards: {
      missingProjectId: await queryCountIfColumns(client, "project_storyboards", ["project_id"], missing("project_id")),
      missingData: await queryCountIfColumns(client, "project_storyboards", ["data"], "data IS NULL"),
      orphanProjects: await queryCountIfReady(
        client,
        { project_storyboards: ["project_id"], projects: ["id"] },
        "project_storyboards ps LEFT JOIN projects p ON p.id = ps.project_id",
        `ps.project_id IS NOT NULL AND btrim(ps.project_id::text) <> '' AND p.id IS NULL`,
      ),
      jsonConflicts: {
        title: await queryCountIfColumns(client, "project_storyboards", ["data", "title"], jsonConflict("title", "title")),
        script: await queryCountIfColumns(client, "project_storyboards", ["data", "script"], jsonConflict("script", "script", "content")),
        imageStatus: await queryCountIfColumns(client, "project_storyboards", ["data", "image_status"], jsonConflict("image_status", "imageStatus", "image_status")),
        videoStatus: await queryCountIfColumns(client, "project_storyboards", ["data", "video_status"], jsonConflict("video_status", "videoStatus", "video_status")),
        promptSummary: await queryCountIfColumns(client, "project_storyboards", ["data", "prompt_summary"], jsonConflict("prompt_summary", "promptSummary", "prompt_summary")),
        imageUrl: await queryCountIfColumns(client, "project_storyboards", ["data", "image_url"], jsonConflict("image_url", "imageUrl", "image_url")),
      },
    },
    project_videos: {
      missingProjectId: await queryCountIfColumns(client, "project_videos", ["project_id"], missing("project_id")),
      missingData: await queryCountIfColumns(client, "project_videos", ["data"], "data IS NULL"),
      orphanProjects: await queryCountIfReady(
        client,
        { project_videos: ["project_id"], projects: ["id"] },
        "project_videos pv LEFT JOIN projects p ON p.id = pv.project_id",
        `pv.project_id IS NOT NULL AND btrim(pv.project_id::text) <> '' AND p.id IS NULL`,
      ),
      orphanStoryboards: await queryCountIfReady(
        client,
        { project_videos: ["storyboard_id"], project_storyboards: ["id"] },
        "project_videos pv LEFT JOIN project_storyboards ps ON ps.id = pv.storyboard_id",
        `pv.storyboard_id IS NOT NULL AND btrim(pv.storyboard_id::text) <> '' AND ps.id IS NULL`,
      ),
      jsonConflicts: {
        storyboardId: await queryCountIfColumns(client, "project_videos", ["data", "storyboard_id"], jsonConflict("storyboard_id", "storyboardId", "storyboard_id")),
        status: await queryCountIfColumns(client, "project_videos", ["data", "status"], jsonConflict("status", "status")),
        videoUrl: await queryCountIfColumns(client, "project_videos", ["data", "video_url"], jsonConflict("video_url", "videoUrl", "video_url", "url")),
        thumbnailUrl: await queryCountIfColumns(client, "project_videos", ["data", "thumbnail_url"], jsonConflict("thumbnail_url", "thumbnailUrl", "thumbnail_url")),
      },
    },
    project_dubbings: {
      missingProjectId: await queryCountIfColumns(client, "project_dubbings", ["project_id"], missing("project_id")),
      missingData: await queryCountIfColumns(client, "project_dubbings", ["data"], "data IS NULL"),
      orphanProjects: await queryCountIfReady(
        client,
        { project_dubbings: ["project_id"], projects: ["id"] },
        "project_dubbings pd LEFT JOIN projects p ON p.id = pd.project_id",
        `pd.project_id IS NOT NULL AND btrim(pd.project_id::text) <> '' AND p.id IS NULL`,
      ),
      orphanStoryboards: await queryCountIfReady(
        client,
        { project_dubbings: ["storyboard_id"], project_storyboards: ["id"] },
        "project_dubbings pd LEFT JOIN project_storyboards ps ON ps.id = pd.storyboard_id",
        `pd.storyboard_id IS NOT NULL AND btrim(pd.storyboard_id::text) <> '' AND ps.id IS NULL`,
      ),
      jsonConflicts: {
        storyboardId: await queryCountIfColumns(client, "project_dubbings", ["data", "storyboard_id"], jsonConflict("storyboard_id", "storyboardId", "storyboard_id")),
        speakerName: await queryCountIfColumns(client, "project_dubbings", ["data", "speaker_name"], jsonConflict("speaker_name", "speakerName", "speaker_name")),
        voicePreset: await queryCountIfColumns(client, "project_dubbings", ["data", "voice_preset"], jsonConflict("voice_preset", "voicePreset", "voice_preset")),
        textContent: await queryCountIfColumns(client, "project_dubbings", ["data", "text_content"], jsonConflict("text_content", "text", "textContent", "text_content")),
        status: await queryCountIfColumns(client, "project_dubbings", ["data", "status"], jsonConflict("status", "status")),
        audioUrl: await queryCountIfColumns(client, "project_dubbings", ["data", "audio_url"], jsonConflict("audio_url", "audioUrl", "audio_url", "url")),
      },
    },
    project_exports: {
      missingProjectId: await queryCountIfColumns(client, "project_exports", ["project_id"], missing("project_id")),
      missingData: await queryCountIfColumns(client, "project_exports", ["data"], "data IS NULL"),
      orphanProjects: await queryCountIfReady(
        client,
        { project_exports: ["project_id"], projects: ["id"] },
        "project_exports pe LEFT JOIN projects p ON p.id = pe.project_id",
        `pe.project_id IS NOT NULL AND btrim(pe.project_id::text) <> '' AND p.id IS NULL`,
      ),
      orphanJobs: await queryCountIfReady(
        client,
        { project_exports: ["job_id"], jobs: ["id"] },
        "project_exports pe LEFT JOIN jobs j ON j.id = pe.job_id",
        "pe.job_id IS NOT NULL AND j.id IS NULL",
      ),
    },
  };

  const totals = {
    legacyRowsWithProjectId: sumCounts(
      legacySources.storyboards.withProjectId,
      legacySources.videos.withProjectId,
      legacySources.dubbings.withProjectId,
    ),
    legacyRowsMissingProjectId: sumCounts(
      legacySources.storyboards.missingProjectId,
      legacySources.videos.missingProjectId,
      legacySources.dubbings.missingProjectId,
    ),
    unprojectedLegacyRows: sumCounts(
      legacySources.storyboards.unprojected,
      legacySources.videos.unprojected,
      legacySources.dubbings.unprojected,
    ),
    missingCanonicalFields: sumCounts(
      canonicalTargets.project_assets.missingProjectId,
      canonicalTargets.project_assets.missingData,
      canonicalTargets.project_storyboards.missingProjectId,
      canonicalTargets.project_storyboards.missingData,
      canonicalTargets.project_videos.missingProjectId,
      canonicalTargets.project_videos.missingData,
      canonicalTargets.project_dubbings.missingProjectId,
      canonicalTargets.project_dubbings.missingData,
      canonicalTargets.project_exports.missingProjectId,
      canonicalTargets.project_exports.missingData,
    ),
    orphanRows: sumCounts(
      canonicalTargets.project_assets.orphanProjects,
      canonicalTargets.project_storyboards.orphanProjects,
      canonicalTargets.project_videos.orphanProjects,
      canonicalTargets.project_videos.orphanStoryboards,
      canonicalTargets.project_dubbings.orphanProjects,
      canonicalTargets.project_dubbings.orphanStoryboards,
      canonicalTargets.project_exports.orphanProjects,
      canonicalTargets.project_exports.orphanJobs,
    ),
    jsonFieldConflicts: sumCounts(
      sumObjectValues(canonicalTargets.project_assets.jsonConflicts),
      sumObjectValues(canonicalTargets.project_storyboards.jsonConflicts),
      sumObjectValues(canonicalTargets.project_videos.jsonConflicts),
      sumObjectValues(canonicalTargets.project_dubbings.jsonConflicts),
    ),
  };

  return { legacySources, canonicalTargets, totals };
}

async function readApiCenterHealth(client) {
  const tableExistsValue = await tableExists(client, "api_center_configs");
  const providerHealthExists = await tableExists(client, "provider_health");
  const healthProviders = new Set();
  const realHealthProviders = new Set();
  const stagedHealthProviders = new Set();
  let providerHealthRows = 0;
  const providerHealthStatusCounts = {};

  if (providerHealthExists) {
    const providerResult = await client.query(
      `SELECT provider, coalesce(status, 'unknown') AS status, count(*)::integer AS rows
       FROM provider_health
       WHERE provider IS NOT NULL
       GROUP BY provider, coalesce(status, 'unknown')`,
    );
    for (const row of providerResult.rows) {
      const provider = normalizeIdentifier(row.provider);
      if (provider) {
        const normalizedProvider = provider.toLowerCase();
        const status = normalizeIdentifier(row.status) || "unknown";
        const rowCount = Number(row.rows || 0);
        healthProviders.add(normalizedProvider);
        providerHealthRows += rowCount;
        providerHealthStatusCounts[status] = Number(providerHealthStatusCounts[status] || 0) + rowCount;
        if (isStagedProviderHealthStatus(status)) {
          stagedHealthProviders.add(normalizedProvider);
        } else {
          realHealthProviders.add(normalizedProvider);
        }
      }
    }
  }

  const health = {
    tableExists: tableExistsValue,
    providerHealthTableExists: providerHealthExists,
    configRows: tableExistsValue ? await queryCount(client, "api_center_configs") : null,
    providerHealthRows,
    providerHealthStatusCounts,
    providerHealthProviders: Array.from(healthProviders).sort(),
    realProviderHealthProviders: Array.from(realHealthProviders).sort(),
    stagedProviderHealthProviders: Array.from(stagedHealthProviders).sort(),
    configs: [],
    totals: {
      invalidJsonRows: 0,
      rowsMissingRequiredSections: 0,
      rawSecretFields: 0,
      duplicateVendorIds: 0,
      invalidVendorIds: 0,
      invalidModelIds: 0,
      invalidModelDomains: 0,
      duplicateModelIds: 0,
      orphanDefaultModels: 0,
      disabledDefaultModels: 0,
      apiKeyStateConflicts: 0,
      configuredVendorsMissingProviderHealth: 0,
      configuredVendorsOnlyStagedProviderHealth: 0,
    },
  };

  if (!tableExistsValue) {
    return health;
  }

  const result = await client.query(
    `SELECT account_id::text AS account_id, data::text AS data_json, updated_at
     FROM api_center_configs
     ORDER BY updated_at DESC, account_id
     LIMIT 200`,
  );

  for (const row of result.rows) {
    const configHealth = analyzeApiCenterConfig(row, {
      any: healthProviders,
      real: realHealthProviders,
      staged: stagedHealthProviders,
    });
    health.configs.push(configHealth);
    for (const key of Object.keys(health.totals)) {
      health.totals[key] += numeric(configHealth[key]);
    }
  }

  return health;
}

function analyzeApiCenterConfig(row, providerHealthProviders) {
  const allowedDomains = new Set(["text", "vision", "image", "video", "audio"]);
  const health = {
    accountId: row.account_id,
    updatedAt: row.updated_at,
    validJson: true,
    vendorCount: 0,
    modelCount: 0,
    invalidJsonRows: 0,
    rowsMissingRequiredSections: 0,
    rawSecretFields: 0,
    rawSecretFieldPaths: [],
    duplicateVendorIds: 0,
    duplicateVendorIdValues: [],
    invalidVendorIds: 0,
    invalidVendorIdValues: [],
    invalidModelIds: 0,
    invalidModelIdValues: [],
    invalidModelDomains: 0,
    invalidModelDomainValues: [],
    duplicateModelIds: 0,
    duplicateModelIdValues: [],
    orphanDefaultModels: 0,
    orphanDefaultModelValues: [],
    disabledDefaultModels: 0,
    disabledDefaultModelValues: [],
    apiKeyStateConflicts: 0,
    apiKeyStateConflictVendors: [],
    configuredVendorsMissingProviderHealth: 0,
    configuredVendorsMissingProviderHealthValues: [],
    configuredVendorsOnlyStagedProviderHealth: 0,
    configuredVendorsOnlyStagedProviderHealthValues: [],
  };

  let config;
  try {
    config = JSON.parse(row.data_json || "{}");
  } catch {
    health.validJson = false;
    health.invalidJsonRows = 1;
    return health;
  }

  if (!asObject(config)) {
    health.validJson = false;
    health.invalidJsonRows = 1;
    return health;
  }

  const secretPaths = collectRawSecretFieldPaths(config);
  health.rawSecretFields = secretPaths.length;
  health.rawSecretFieldPaths = secretPaths.slice(0, 50);

  const vendors = Array.isArray(config.vendors) ? config.vendors : null;
  const defaults = asObject(config.defaults);
  if (!vendors || !defaults) {
    health.rowsMissingRequiredSections = 1;
  }

  const vendorIds = new Set();
  const modelIds = new Set();
  const modelIndex = new Map();
  for (const vendor of asArray(vendors)) {
    const vendorObject = asObject(vendor);
    const vendorId = normalizeIdentifier(vendorObject?.id);
    if (!vendorId || !/^[a-z0-9][a-z0-9._-]{1,63}$/i.test(vendorId)) {
      health.invalidVendorIds += 1;
      health.invalidVendorIdValues.push(vendorId || "<blank>");
      continue;
    }

    const normalizedVendorId = vendorId.toLowerCase();
    if (vendorIds.has(normalizedVendorId)) {
      health.duplicateVendorIds += 1;
      health.duplicateVendorIdValues.push(vendorId);
    }
    vendorIds.add(normalizedVendorId);
    health.vendorCount += 1;

    const hasConfiguredKey = vendorObject.apiKeyConfigured === true
      || vendorObject.connected === true
      || normalizeIdentifier(vendorObject.apiKeyHash) !== null;
    if (normalizeIdentifier(vendorObject.apiKeyHash) !== null && vendorObject.apiKeyConfigured === false) {
      health.apiKeyStateConflicts += 1;
      health.apiKeyStateConflictVendors.push(vendorId);
    }

    if (hasConfiguredKey) {
      if (!providerHealthProviders.any.has(normalizedVendorId)) {
        health.configuredVendorsMissingProviderHealth += 1;
        health.configuredVendorsMissingProviderHealthValues.push(vendorId);
      } else if (
        !providerHealthProviders.real.has(normalizedVendorId)
        && providerHealthProviders.staged.has(normalizedVendorId)
      ) {
        health.configuredVendorsOnlyStagedProviderHealth += 1;
        health.configuredVendorsOnlyStagedProviderHealthValues.push(vendorId);
      }
    }

    for (const model of asArray(vendorObject.models)) {
      const modelObject = asObject(model);
      const modelId = normalizeIdentifier(modelObject?.id);
      const domain = normalizeIdentifier(modelObject?.domain);
      if (!modelId) {
        health.invalidModelIds += 1;
        health.invalidModelIdValues.push(`${vendorId}:<blank>`);
        continue;
      }

      if (modelIds.has(modelId)) {
        health.duplicateModelIds += 1;
        health.duplicateModelIdValues.push(modelId);
      }
      modelIds.add(modelId);
      health.modelCount += 1;

      if (!domain || !allowedDomains.has(domain)) {
        health.invalidModelDomains += 1;
        health.invalidModelDomainValues.push(`${vendorId}:${modelId}:${domain || "<blank>"}`);
      }

      modelIndex.set(modelId, {
        enabled: modelObject.enabled !== false,
        vendorId,
        domain,
      });
    }
  }

  for (const [defaultKey, modelIdValue] of Object.entries(defaults || {})) {
    const modelId = normalizeIdentifier(modelIdValue);
    if (!modelId) {
      continue;
    }

    const model = modelIndex.get(modelId);
    if (!model) {
      health.orphanDefaultModels += 1;
      health.orphanDefaultModelValues.push(`${defaultKey}:${modelId}`);
    } else if (!model.enabled) {
      health.disabledDefaultModels += 1;
      health.disabledDefaultModelValues.push(`${defaultKey}:${modelId}`);
    }
  }

  return health;
}

function sumSnapshotCounts(snapshot, names) {
  if (!snapshot.present) return 0;
  return names.reduce((total, name) => total + Number(snapshot.projectionCounts[name] || 0), 0);
}

function sourceCount(sources, tableName, field = "count") {
  const value = sources?.[tableName]?.[field];
  return value === null || value === undefined ? 0 : Number(value);
}

function buildProjectionMatrix(snapshot, sources, targets, apiCenterHealth) {
  return [
    {
      area: "accounts",
      sources: {
        snapshotUsersAndOrganizations: sumSnapshotCounts(snapshot, ["users", "organizations"]),
        sqlWalletOwners: sourceCount(sources, "wallets"),
      },
      target: {
        table: "accounts",
        rows: targets.accounts.count,
        withLegacyOwner: targets.accounts.withLegacyOwner,
      },
      requiredTargetSignal: "accounts.legacy_owner_type + accounts.legacy_owner_id",
    },
    {
      area: "jobs",
      sources: {
        snapshotTasks: sumSnapshotCounts(snapshot, ["tasks"]),
        sqlTasks: sourceCount(sources, "tasks"),
        sqlProviderJobs: sourceCount(sources, "provider_jobs"),
        sqlVideoReplaceJobs: sourceCount(sources, "video_replace_jobs"),
        activeLegacyTasks: sourceCount(sources, "tasks", "activeCount"),
        activeProviderJobs: sourceCount(sources, "provider_jobs", "activeCount"),
        activeVideoReplaceJobs: sourceCount(sources, "video_replace_jobs", "activeCount"),
      },
      target: {
        table: "jobs",
        rows: targets.jobs.count,
        withLegacyPayload: targets.jobs.withLegacyPayload,
        withLegacyTaskPayload: targets.jobs.withLegacyTaskPayload,
        withLegacyProviderJobPayload: targets.jobs.withLegacyProviderJobPayload,
        withLegacyVideoReplacePayload: targets.jobs.withLegacyVideoReplacePayload,
        activeRows: targets.jobs.activeCount,
      },
      requiredTargetSignal: "jobs.payload legacy ids or idempotency keys before legacy workers stop",
    },
    {
      area: "payments",
      sources: {
        snapshotRechargeOrders: sumSnapshotCounts(snapshot, ["wallet_recharge_orders"]),
        sqlRechargeOrders: sourceCount(sources, "wallet_recharge_orders"),
        sqlPaidRechargeOrders: sourceCount(sources, "wallet_recharge_orders", "paidOrSucceededCount"),
        sqlPaymentEvents: sourceCount(sources, "payment_events"),
        verifiedPaymentEvents: sourceCount(sources, "payment_events", "verifiedCount"),
      },
      target: {
        orderTable: "payment_orders",
        callbackTable: "payment_callbacks",
        ordersWithLegacyRechargeOrder: targets.payment_orders.withLegacyRechargeOrder,
        validProcessedCallbacks: targets.payment_callbacks.validProcessed,
      },
      requiredTargetSignal: "payment_orders.legacy_recharge_order_id and payment_callbacks(provider,event_id)",
    },
    {
      area: "wallet",
      sources: {
        snapshotWallets: sumSnapshotCounts(snapshot, ["wallets"]),
        snapshotWalletLedger: sumSnapshotCounts(snapshot, ["wallet_ledger"]),
        sqlWallets: sourceCount(sources, "wallets"),
        sqlWalletLedger: sourceCount(sources, "wallet_ledger"),
      },
      target: {
        ledgerTable: "wallet_ledger",
        balanceTable: "wallet_balances",
        ledgerRows: targets.wallet_ledger.count,
        canonicalLedgerRows: targets.wallet_ledger.canonicalRows,
        missingCanonicalFields: targets.wallet_ledger.missingCanonicalFields,
        balances: targets.wallet_balances.count,
      },
      requiredTargetSignal: "wallet_ledger.account_id/currency/idempotency_key/immutable and wallet_balances audit",
    },
    {
      area: "media",
      sources: {
        snapshotAssetsAndOutputs: sumSnapshotCounts(snapshot, [
          "project_assets",
          "storyboards",
          "videos",
          "dubbings",
          "create_studio_images",
          "create_studio_videos",
        ]),
        sqlProjectAssets: sourceCount(sources, "project_assets"),
        sqlStoryboards: sourceCount(sources, "storyboards"),
        sqlVideos: sourceCount(sources, "videos"),
        sqlDubbings: sourceCount(sources, "dubbings"),
        sqlCreateStudioImages: sourceCount(sources, "create_studio_images"),
        sqlCreateStudioVideos: sourceCount(sources, "create_studio_videos"),
      },
      target: {
        projectAssetsTable: "project_assets",
        projectAssets: targets.project_assets.count,
        projectStoryboardsTable: "project_storyboards",
        projectStoryboards: targets.project_storyboards.count,
        projectVideosTable: "project_videos",
        projectVideos: targets.project_videos.count,
        projectDubbingsTable: "project_dubbings",
        projectDubbings: targets.project_dubbings.count,
        mediaObjectsTable: "media_objects",
        mediaObjects: targets.media_objects.count,
        mediaObjectsWithLegacyPayload: targets.media_objects.withLegacyPayload,
        permanentLegacyMediaRows: targets.media_objects.permanentLegacyRows,
      },
      requiredTargetSignal: "project-adjacent legacy rows are canonicalized into project_* tables; create-studio outputs still require media_objects provenance",
    },
    {
      area: "outbox",
      sources: {
        paymentAndJobProjectionEvents: "operator-reviewed",
      },
      target: {
        table: "outbox_events",
        rows: targets.outbox_events.count,
      },
      requiredTargetSignal: "pending/processed outbox events are replayable and not used as the source of truth",
    },
    {
      area: "api-center",
      sources: {
        legacyVendorSecrets: "not accepted as runtime source",
      },
      target: {
        configTable: "api_center_configs",
        configRows: targets.api_center_configs.count,
        providerHealthTable: "provider_health",
        providerHealthRows: apiCenterHealth?.providerHealthRows ?? targets.provider_health.count,
      },
      requiredTargetSignal: "vendor config is canonical JSON without raw secrets; defaults point at enabled models; configured vendors have provider_health evidence",
    },
  ];
}

function evaluateReport(report, args) {
  const {
    findings,
    snapshot,
    legacySqlSources: sources,
    canonicalTargets: targets,
    projectAdjacentHealth,
    apiCenterHealth,
  } = report;

  const legacyOnlySourceRows = [
    "tasks",
    "provider_jobs",
    "video_replace_jobs",
    "wallet_recharge_orders",
    "payment_events",
    "wallets",
    "project_assets",
    "storyboards",
    "videos",
    "dubbings",
    "create_studio_images",
    "create_studio_videos",
  ].reduce((total, tableName) => total + Number(sources?.[tableName]?.count || 0), 0);
  const hasSnapshotRows = snapshot.present
    && Object.values(snapshot.projectionCounts || {}).some((count) => Number(count) > 0);

  if (!snapshot.present) {
    addFinding(
      findings,
      args.allowMissingLegacy ? "warning" : "blocker",
      "missing-legacy-snapshot",
      `No legacy snapshot is available: ${snapshot.reason}.`,
    );
  }

  if (!hasSnapshotRows && legacyOnlySourceRows === 0) {
    addFinding(
      findings,
      args.allowMissingLegacy ? "warning" : "blocker",
      "missing-legacy-source",
      "No legacy snapshot rows or legacy SQL source rows were found. A real cutover must point this check at the captured legacy source.",
    );
  }

  for (const [tableName, target] of Object.entries(targets)) {
    if (!target.exists) {
      addFinding(findings, "blocker", "missing-canonical-table", `Canonical table ${tableName} is missing.`);
    }
  }

  const snapshotAccounts = sumSnapshotCounts(snapshot, ["users", "organizations"]);
  if (snapshotAccounts > 0 && Number(targets.accounts.withLegacyOwner || 0) === 0) {
    addFinding(
      findings,
      "blocker",
      "accounts-not-projected",
      "Legacy users/organizations exist, but accounts.legacy_owner_type/legacy_owner_id has no projected rows.",
      { snapshotAccounts },
    );
  }

  const activeLegacyTasks = sourceCount(sources, "tasks", "activeCount");
  const activeProviderJobs = sourceCount(sources, "provider_jobs", "activeCount");
  const activeVideoReplaceJobs = sourceCount(sources, "video_replace_jobs", "activeCount");
  const activeLegacyJobs = activeLegacyTasks + activeProviderJobs + activeVideoReplaceJobs;
  const projectedLegacyTasks = Number(targets.jobs.withLegacyTaskPayload || 0);
  const projectedProviderJobs = Number(targets.jobs.withLegacyProviderJobPayload || 0);
  const projectedVideoReplaceJobs = Number(targets.jobs.withLegacyVideoReplacePayload || 0);
  const projectedLegacyJobs = Number(targets.jobs.withLegacyPayload || 0);
  let hasUnprojectedActiveLegacyJob = false;
  if (activeLegacyTasks > 0 && projectedLegacyTasks < activeLegacyTasks) {
    hasUnprojectedActiveLegacyJob = true;
    addFinding(
      findings,
      "blocker",
      "legacy-active-tasks",
      "Legacy task rows are still non-terminal and do not have enough canonical job projection proof.",
      { activeLegacyTasks, projectedLegacyTasks },
    );
  }
  if (activeProviderJobs > 0 && projectedProviderJobs < activeProviderJobs) {
    hasUnprojectedActiveLegacyJob = true;
    addFinding(
      findings,
      "blocker",
      "legacy-active-provider-jobs",
      "Legacy provider_jobs rows are still non-terminal and do not have enough canonical job projection proof.",
      { activeProviderJobs, projectedProviderJobs },
    );
  }
  if (activeVideoReplaceJobs > 0 && projectedVideoReplaceJobs < activeVideoReplaceJobs) {
    hasUnprojectedActiveLegacyJob = true;
    addFinding(
      findings,
      "blocker",
      "legacy-active-video-replace-jobs",
      "Legacy video_replace_jobs rows are still non-terminal and do not have enough canonical job projection proof.",
      { activeVideoReplaceJobs, projectedVideoReplaceJobs },
    );
  }
  if (activeLegacyJobs > 0 && !hasUnprojectedActiveLegacyJob && !args.legacyWritesFrozen) {
    addFinding(
      findings,
      "warning",
      "legacy-active-jobs-projected",
      "Legacy task/provider/video job rows are still non-terminal, but canonical jobs expose recognized legacy ids. Operators must still freeze legacy writers before cutover.",
      {
        activeLegacyJobs,
        projectedLegacyJobs,
        activeLegacyTasks,
        projectedLegacyTasks,
        activeProviderJobs,
        projectedProviderJobs,
        activeVideoReplaceJobs,
        projectedVideoReplaceJobs,
      },
    );
  }

  const legacyJobSources =
    sumSnapshotCounts(snapshot, ["tasks"])
    + sourceCount(sources, "tasks")
    + sourceCount(sources, "provider_jobs")
    + sourceCount(sources, "video_replace_jobs");
  if (legacyJobSources > 0 && Number(targets.jobs.withLegacyPayload || 0) === 0) {
    addFinding(
      findings,
      "warning",
      "jobs-need-manual-projection-proof",
      "Legacy job sources exist, but canonical jobs do not expose recognized legacy ids in payload. Keep legacy job reads closed until operators verify the mapping.",
      { legacyJobSources },
    );
  }

  const paidRechargeOrders = sourceCount(sources, "wallet_recharge_orders", "paidOrSucceededCount");
  if (paidRechargeOrders > 0 && Number(targets.payment_orders.withLegacyRechargeOrder || 0) < paidRechargeOrders) {
    addFinding(
      findings,
      "blocker",
      "payment-orders-not-projected",
      "Paid legacy recharge orders are not fully represented by canonical payment_orders.legacy_recharge_order_id.",
      { paidRechargeOrders, projected: targets.payment_orders.withLegacyRechargeOrder },
    );
  }

  const verifiedPaymentEvents = sourceCount(sources, "payment_events", "verifiedCount");
  if (verifiedPaymentEvents > 0 && Number(targets.payment_callbacks.validProcessed || 0) < verifiedPaymentEvents) {
    addFinding(
      findings,
      "blocker",
      "payment-events-not-projected",
      "Verified legacy payment_events are not fully represented by canonical payment_callbacks.",
      { verifiedPaymentEvents, projected: targets.payment_callbacks.validProcessed },
    );
  }

  if (Number(targets.wallet_ledger.missingCanonicalFields || 0) > 0) {
    addFinding(
      findings,
      "blocker",
      "wallet-ledger-missing-canonical-fields",
      "wallet_ledger has rows missing canonical account/currency/idempotency/immutable fields. Do not cut over finance writes until ledger audit is clean.",
      { rows: targets.wallet_ledger.missingCanonicalFields },
    );
  }

  const snapshotProjectAdjacentSources = sumSnapshotCounts(
    snapshot,
    ["project_assets", "storyboards", "videos", "dubbings"],
  );
  const sqlProjectAdjacentSources =
    sourceCount(sources, "project_assets")
    + sourceCount(sources, "storyboards")
    + sourceCount(sources, "videos")
    + sourceCount(sources, "dubbings");
  const legacyProjectAdjacentSources = Math.max(snapshotProjectAdjacentSources, sqlProjectAdjacentSources);
  const projectedProjectAdjacent =
    Number(targets.project_assets.count || 0)
    + Number(targets.project_storyboards.count || 0)
    + Number(targets.project_videos.count || 0)
    + Number(targets.project_dubbings.count || 0);
  if (legacyProjectAdjacentSources > 0 && projectedProjectAdjacent < legacyProjectAdjacentSources) {
    addFinding(
      findings,
      "blocker",
      "legacy-project-adjacent-not-canonicalized",
      "Legacy project-adjacent rows are not fully represented by canonical project_* tables.",
      { legacyProjectAdjacentSources, projectedProjectAdjacent },
    );
  }

  if (projectAdjacentHealth) {
    const totals = projectAdjacentHealth.totals || {};
    if (numeric(totals.legacyRowsMissingProjectId) > 0) {
      addFinding(
        findings,
        "blocker",
        "project-adjacent-legacy-missing-project-id",
        "Legacy storyboards/videos/dubbings contain rows without project_id, so they cannot be safely mapped to project_* canonical tables.",
        { rows: totals.legacyRowsMissingProjectId, legacySources: projectAdjacentHealth.legacySources },
      );
    }

    if (numeric(totals.unprojectedLegacyRows) > 0) {
      addFinding(
        findings,
        "blocker",
        "project-adjacent-unprojected-legacy-rows",
        "Legacy storyboards/videos/dubbings rows with project_id are not fully represented by their project_* canonical tables.",
        { rows: totals.unprojectedLegacyRows, legacySources: projectAdjacentHealth.legacySources },
      );
    }

    if (numeric(totals.missingCanonicalFields) > 0) {
      addFinding(
        findings,
        "blocker",
        "project-adjacent-canonical-required-fields-missing",
        "Project-adjacent canonical tables contain rows missing required canonical project_id or data fields.",
        { rows: totals.missingCanonicalFields, canonicalTargets: projectAdjacentHealth.canonicalTargets },
      );
    }

    if (numeric(totals.orphanRows) > 0) {
      addFinding(
        findings,
        "blocker",
        "project-adjacent-canonical-orphans",
        "Project-adjacent canonical rows reference missing projects, storyboards, jobs, or other canonical parents.",
        { rows: totals.orphanRows, canonicalTargets: projectAdjacentHealth.canonicalTargets },
      );
    }

    if (numeric(totals.jsonFieldConflicts) > 0) {
      addFinding(
        findings,
        "blocker",
        "project-adjacent-json-field-conflicts",
        "Project-adjacent canonical columns conflict with legacy JSON attributes preserved in data. Resolve the conflict before retiring legacy fields.",
        { rows: totals.jsonFieldConflicts, canonicalTargets: projectAdjacentHealth.canonicalTargets },
      );
    }

    if (numeric(totals.legacyRowsWithProjectId) > 0 && !args.legacyWritesFrozen) {
      addFinding(
        findings,
        "warning",
        "project-adjacent-legacy-rows-present",
        "Legacy storyboards/videos/dubbings rows are present and projected; operators must still freeze legacy writers before final cleanup.",
        { rows: totals.legacyRowsWithProjectId, legacySources: projectAdjacentHealth.legacySources },
      );
    }
  }

  if (apiCenterHealth) {
    const totals = apiCenterHealth.totals || {};
    if (!apiCenterHealth.tableExists) {
      addFinding(
        findings,
        "blocker",
        "api-center-config-table-missing",
        "Canonical api_center_configs table is missing; API vendor configuration must not fall back to frontend-local drafts.",
      );
    }

    if (numeric(totals.invalidJsonRows) > 0) {
      addFinding(
        findings,
        "blocker",
        "api-center-config-invalid-json",
        "api_center_configs contains invalid JSON rows.",
        { rows: totals.invalidJsonRows, configs: apiCenterHealth.configs },
      );
    }

    if (numeric(totals.rowsMissingRequiredSections) > 0) {
      addFinding(
        findings,
        "blocker",
        "api-center-config-missing-sections",
        "api_center_configs rows must include canonical vendors and defaults sections.",
        { rows: totals.rowsMissingRequiredSections, configs: apiCenterHealth.configs },
      );
    }

    if (numeric(totals.rawSecretFields) > 0) {
      addFinding(
        findings,
        "blocker",
        "api-center-raw-secret-fields",
        "API-center vendor config contains raw secret-looking fields. Store only flags and apiKeyHash in canonical config evidence.",
        { fields: totals.rawSecretFields, configs: apiCenterHealth.configs },
      );
    }

    if (numeric(totals.duplicateVendorIds) > 0 || numeric(totals.invalidVendorIds) > 0) {
      addFinding(
        findings,
        "blocker",
        "api-center-vendor-id-integrity",
        "API-center vendor ids must be valid and unique before vendor management becomes a runtime control surface.",
        {
          duplicateVendorIds: totals.duplicateVendorIds,
          invalidVendorIds: totals.invalidVendorIds,
          configs: apiCenterHealth.configs,
        },
      );
    }

    if (
      numeric(totals.invalidModelIds) > 0
      || numeric(totals.invalidModelDomains) > 0
      || numeric(totals.duplicateModelIds) > 0
    ) {
      addFinding(
        findings,
        "blocker",
        "api-center-model-integrity",
        "API-center model ids and domains must be valid and unambiguous.",
        {
          invalidModelIds: totals.invalidModelIds,
          invalidModelDomains: totals.invalidModelDomains,
          duplicateModelIds: totals.duplicateModelIds,
          configs: apiCenterHealth.configs,
        },
      );
    }

    if (numeric(totals.orphanDefaultModels) > 0 || numeric(totals.disabledDefaultModels) > 0) {
      addFinding(
        findings,
        "blocker",
        "api-center-default-model-integrity",
        "API-center default model assignments must point at enabled canonical vendor models.",
        {
          orphanDefaultModels: totals.orphanDefaultModels,
          disabledDefaultModels: totals.disabledDefaultModels,
          configs: apiCenterHealth.configs,
        },
      );
    }

    if (numeric(totals.apiKeyStateConflicts) > 0) {
      addFinding(
        findings,
        "blocker",
        "api-center-api-key-state-conflict",
        "API-center vendor config has apiKeyHash evidence but reports apiKeyConfigured=false.",
        { rows: totals.apiKeyStateConflicts, configs: apiCenterHealth.configs },
      );
    }

    if (numeric(totals.configuredVendorsMissingProviderHealth) > 0) {
      addFinding(
        findings,
        "warning",
        "api-center-provider-health-missing",
        "Configured API-center vendors do not yet have provider_health evidence. Keep real vendor routing gated until health evidence is present.",
        { vendors: totals.configuredVendorsMissingProviderHealth, configs: apiCenterHealth.configs },
      );
    }

    if (numeric(totals.configuredVendorsOnlyStagedProviderHealth) > 0) {
      addFinding(
        findings,
        "warning",
        "api-center-provider-health-staged-only",
        "Configured API-center vendors only have staged provider_health evidence_pending rows. This proves canonical plumbing, not real vendor health.",
        {
          vendors: totals.configuredVendorsOnlyStagedProviderHealth,
          providerHealthStatusCounts: apiCenterHealth.providerHealthStatusCounts,
          configs: apiCenterHealth.configs,
        },
      );
    }
  }

  const snapshotMediaSources = sumSnapshotCounts(
    snapshot,
    ["create_studio_images", "create_studio_videos"],
  );
  const sqlMediaSources =
    sourceCount(sources, "create_studio_images")
    + sourceCount(sources, "create_studio_videos");
  const legacyMediaSources = Math.max(snapshotMediaSources, sqlMediaSources);
  const projectedLegacyMedia = Number(targets.media_objects.permanentLegacyRows || targets.media_objects.withLegacyPayload || 0);
  if (legacyMediaSources > 0 && projectedLegacyMedia < legacyMediaSources) {
    addFinding(
      findings,
      "blocker",
      "legacy-media-not-projected",
      "Legacy create-studio media output rows are not fully represented by canonical media_objects with legacy provenance and permanent object keys.",
      { legacyMediaSources, projectedLegacyMedia },
    );
  }

  if (process.env.CORE_API_COMPAT_READ_ONLY !== "1") {
    addFinding(
      findings,
      "warning",
      "core-api-readonly-env-not-set",
      "CORE_API_COMPAT_READ_ONLY is not set to 1 in this process. Production compatibility core-api must be read-only.",
    );
  }

  report.ok = !findings.some((finding) => finding.severity === "blocker");
  report.status = report.ok ? "ok" : "blocked";
  if (!args.strict) {
    report.exitPolicy = "report-only";
  } else if (report.ok) {
    report.exitPolicy = "strict-ok";
  } else {
    report.exitPolicy = "strict-blocked";
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const databaseUrl = args.databaseUrl || process.env.DATABASE_URL || DEFAULT_DATABASE_URL;
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  const client = await pool.connect();
  try {
    const snapshot = await readSnapshotProjection(client, args.snapshotKey);
    const legacySqlSources = await readLegacySqlSources(client);
    const canonicalTargets = await readCanonicalTargets(client);
    const projectAdjacentHealth = await readProjectAdjacentHealth(client);
    const apiCenterHealth = await readApiCenterHealth(client);
    const report = {
      generatedAt: new Date().toISOString(),
      databaseUrl: redactDatabaseUrl(databaseUrl),
      snapshotKey: args.snapshotKey,
      strict: args.strict,
      allowMissingLegacy: args.allowMissingLegacy,
      operatorAssertions: {
        legacyWritesFrozen: args.legacyWritesFrozen,
      },
      snapshot,
      legacySqlSources,
      canonicalTargets,
      projectAdjacentHealth,
      apiCenterHealth,
      projectionMatrix: buildProjectionMatrix(snapshot, legacySqlSources, canonicalTargets, apiCenterHealth),
      findings: [],
    };

    evaluateReport(report, args);

    const text = JSON.stringify(report, null, 2);
    if (args.reportPath) {
      const reportPath = resolve(args.reportPath);
      mkdirSync(dirname(reportPath), { recursive: true });
      writeFileSync(reportPath, `${text}\n`, "utf8");
    }

    console.log(text);
    if (args.strict && !report.ok) {
      process.exitCode = 1;
    }
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
