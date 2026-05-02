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
  "jobs",
  "job_attempts",
  "payment_orders",
  "payment_callbacks",
  "wallet_ledger",
  "wallet_balances",
  "media_objects",
  "outbox_events",
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

function sumSnapshotCounts(snapshot, names) {
  if (!snapshot.present) return 0;
  return names.reduce((total, name) => total + Number(snapshot.projectionCounts[name] || 0), 0);
}

function sourceCount(sources, tableName, field = "count") {
  const value = sources?.[tableName]?.[field];
  return value === null || value === undefined ? 0 : Number(value);
}

function buildProjectionMatrix(snapshot, sources, targets) {
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
          "videos",
          "dubbings",
          "create_studio_images",
          "create_studio_videos",
        ]),
        sqlProjectAssets: sourceCount(sources, "project_assets"),
        sqlVideos: sourceCount(sources, "videos"),
        sqlDubbings: sourceCount(sources, "dubbings"),
        sqlCreateStudioImages: sourceCount(sources, "create_studio_images"),
        sqlCreateStudioVideos: sourceCount(sources, "create_studio_videos"),
      },
      target: {
        table: "media_objects",
        rows: targets.media_objects.count,
        withLegacyPayload: targets.media_objects.withLegacyPayload,
        permanentLegacyRows: targets.media_objects.permanentLegacyRows,
      },
      requiredTargetSignal: "media_objects rows with permanent object keys and legacy source ids in data",
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
  ];
}

function evaluateReport(report, args) {
  const { findings, snapshot, legacySqlSources: sources, canonicalTargets: targets } = report;

  const legacyOnlySourceRows = [
    "tasks",
    "provider_jobs",
    "video_replace_jobs",
    "wallet_recharge_orders",
    "payment_events",
    "wallets",
    "project_assets",
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

  const snapshotMediaSources = sumSnapshotCounts(
    snapshot,
    ["project_assets", "videos", "dubbings", "create_studio_images", "create_studio_videos"],
  );
  const sqlMediaSources =
    sourceCount(sources, "project_assets")
    + sourceCount(sources, "videos")
    + sourceCount(sources, "dubbings")
    + sourceCount(sources, "create_studio_images")
    + sourceCount(sources, "create_studio_videos");
  const legacyMediaSources = Math.max(snapshotMediaSources, sqlMediaSources);
  const projectedLegacyMedia = Number(targets.media_objects.permanentLegacyRows || targets.media_objects.withLegacyPayload || 0);
  if (legacyMediaSources > 0 && projectedLegacyMedia < legacyMediaSources) {
    addFinding(
      findings,
      "blocker",
      "legacy-media-not-projected",
      "Legacy project/media output rows are not fully represented by canonical media_objects with legacy provenance and permanent object keys.",
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
      projectionMatrix: buildProjectionMatrix(snapshot, legacySqlSources, canonicalTargets),
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
