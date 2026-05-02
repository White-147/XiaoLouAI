require("../src/env").loadEnvFiles();

const { createHash } = require("node:crypto");
const { mkdirSync, writeFileSync } = require("node:fs");
const { dirname, resolve } = require("node:path");
const { Pool } = require("pg");
const { DEFAULT_DATABASE_URL } = require("../src/postgres-store");

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TERMINAL_JOB_STATUSES = new Set(["succeeded", "failed", "cancelled"]);
const PAID_ORDER_STATUSES = new Set(["paid", "success", "succeeded", "completed", "confirmed"]);

function parseArgs(argv) {
  const args = {
    execute: false,
    allowNonStaging: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--database-url" || arg === "--url") {
      args.databaseUrl = argv[index + 1];
      index += 1;
    } else if (arg === "--report-path") {
      args.reportPath = argv[index + 1];
      index += 1;
    } else if (arg === "--execute") {
      args.execute = true;
    } else if (arg === "--allow-non-staging") {
      args.allowNonStaging = true;
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

function text(value) {
  if (value === undefined || value === null) return null;
  const normalized = String(value).trim();
  return normalized || null;
}

function asObject(value) {
  if (!value) return {};
  if (typeof value === "object" && !Array.isArray(value)) return value;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  return {};
}

function numberOrZero(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function decimalString(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "0";
  return String(numeric);
}

function centsString(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "0";
  return String(Math.round(numeric * 100));
}

function legacyUuid(entity, value) {
  const normalized = text(value);
  if (!normalized) return null;
  if (UUID_RE.test(normalized)) return normalized.toLowerCase();
  const hash = createHash("md5").update(`xiaolou:${entity}:${normalized}`).digest("hex");
  return [
    hash.slice(0, 8),
    hash.slice(8, 12),
    hash.slice(12, 16),
    hash.slice(16, 20),
    hash.slice(20, 32),
  ].join("-");
}

function sha256Json(value) {
  return createHash("sha256").update(JSON.stringify(value ?? {})).digest("hex");
}

function normalizeOwnerType(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return ["organization", "org", "enterprise", "team"].includes(normalized) ? "organization" : "user";
}

function normalizeJobStatus(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (["succeeded", "success", "completed", "done"].includes(normalized)) return "succeeded";
  if (["failed", "error", "errored"].includes(normalized)) return "failed";
  if (["cancelled", "canceled"].includes(normalized)) return "cancelled";
  if (["queued", "pending", "waiting"].includes(normalized)) return "queued";
  if (["retry", "retry_waiting", "retrying"].includes(normalized)) return "retry_waiting";
  return "running";
}

function normalizePaymentStatus(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (PAID_ORDER_STATUSES.has(normalized)) return "paid";
  if (["failed", "error", "errored"].includes(normalized)) return "failed";
  if (["expired", "timeout", "timed_out"].includes(normalized)) return "expired";
  if (["cancelled", "canceled"].includes(normalized)) return "cancelled";
  if (["refunded", "refund"].includes(normalized)) return "refunded";
  if (["pending", "processing", "created"].includes(normalized)) return "pending";
  return "created";
}

function inferLane(task) {
  const value = [
    task.type,
    task.action_code,
    asObject(task.data).type,
    asObject(task.data).actionCode,
  ].filter(Boolean).join(":").toLowerCase();
  if (/(wallet|payment|pay|recharge|ledger|refund|settle|freeze)/.test(value)) return "account-finance";
  if (/(user|org|organization|auth|session|admin|control)/.test(value)) return "account-control";
  return "account-media";
}

function legacyDataId(row, fallbackEntity) {
  const data = asObject(row.data);
  return text(data.id) || text(row.legacy_id) || text(row.id) || legacyUuid(fallbackEntity, JSON.stringify(data));
}

function firstText(...values) {
  for (const value of values) {
    const normalized = text(value);
    if (normalized) return normalized;
  }
  return null;
}

function safePathSegment(value) {
  return String(value || "unknown")
    .trim()
    .replace(/\\/g, "/")
    .replace(/[^a-zA-Z0-9._/-]+/g, "-")
    .replace(/\/+/g, "/")
    .replace(/^\/|\/$/g, "")
    || "unknown";
}

function inferMediaTypeFromUrl(value, fallback = "file") {
  const normalized = String(value || "").toLowerCase();
  if (/\.(png|jpg|jpeg|webp|gif|bmp)(\?|#|$)/.test(normalized)) return "image";
  if (/\.(mp4|mov|webm|mkv|avi)(\?|#|$)/.test(normalized)) return "video";
  if (/\.(mp3|wav|m4a|aac|ogg|flac)(\?|#|$)/.test(normalized)) return "audio";
  return fallback;
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
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_schema = current_schema()
       AND table_name = $1`,
    [tableName],
  );
  return new Set(result.rows.map((row) => row.column_name));
}

function normalizeOrderColumns(value) {
  if (Array.isArray(value)) return value.map(text).filter(Boolean);
  return String(value || "")
    .split(",")
    .map((item) => text(item))
    .filter(Boolean);
}

async function readRows(client, tableName, orderBy = ["id"]) {
  if (!(await tableExists(client, tableName))) return [];
  const columns = await getColumns(client, tableName);
  const orderColumns = normalizeOrderColumns(orderBy).filter((columnName) => columns.has(columnName));
  const orderSql = orderColumns.length > 0 ? ` ORDER BY ${orderColumns.join(", ")}` : "";
  const result = await client.query(`SELECT * FROM ${tableName}${orderSql}`);
  return result.rows;
}

async function currentSchema(client) {
  const result = await client.query("SELECT current_schema() AS schema");
  return result.rows[0]?.schema || "public";
}

function putAccountAlias(accountMap, ownerType, ownerId, accountId) {
  const normalizedType = normalizeOwnerType(ownerType);
  const normalizedId = text(ownerId);
  if (!normalizedId || !accountId) return;
  accountMap.set(`${normalizedType}:${normalizedId}`, accountId);
  accountMap.set(`${normalizedType}:${legacyUuid(normalizedType, normalizedId)}`, accountId);
  if (normalizedType === "organization") {
    accountMap.set(`org:${normalizedId}`, accountId);
    accountMap.set(`org:${legacyUuid("organization", normalizedId)}`, accountId);
  }
}

function resolveAccount(accountMap, ownerType, ownerId) {
  const normalizedType = normalizeOwnerType(ownerType);
  const normalizedId = text(ownerId);
  if (!normalizedId) return null;
  return accountMap.get(`${normalizedType}:${normalizedId}`)
    || accountMap.get(`${normalizedType}:${legacyUuid(normalizedType, normalizedId)}`)
    || null;
}

function buildProjection(rows) {
  const accountsByKey = new Map();
  const accountMap = new Map();
  const walletAccountMap = new Map();
  const projectAccountMap = new Map();
  const warnings = [];

  function ensureAccount(ownerType, ownerId, sourceTable, row, overrides = {}) {
    const normalizedType = normalizeOwnerType(ownerType);
    const legacyOwnerId = text(ownerId);
    if (!legacyOwnerId) return null;
    const key = `${normalizedType}:${legacyOwnerId}`;
    if (accountsByKey.has(key)) return accountsByKey.get(key);

    const rowData = asObject(row?.data);
    const accountId = legacyUuid("account", key);
    const account = {
      id: accountId,
      accountType: normalizedType,
      legacyOwnerType: normalizedType,
      legacyOwnerId,
      status: text(overrides.status) || text(row?.status) || text(rowData.status) || "active",
      regionCode: text(overrides.regionCode) || "CN",
      defaultCurrency: text(overrides.defaultCurrency) || "CNY",
      data: {
        ...rowData,
        legacyProjection: {
          sourceTable,
          sourceRowId: text(row?.id),
          legacyOwnerType: normalizedType,
          legacyOwnerId,
        },
      },
      createdAt: text(row?.created_at) || text(rowData.createdAt),
      updatedAt: text(row?.updated_at) || text(rowData.updatedAt),
      sourceTable,
      rowId: text(row?.id),
    };
    accountsByKey.set(key, account);
    putAccountAlias(accountMap, normalizedType, legacyOwnerId, accountId);
    putAccountAlias(accountMap, normalizedType, row?.id, accountId);
    return account;
  }

  for (const user of rows.users) {
    const data = asObject(user.data);
    ensureAccount("user", text(data.id) || user.id, "users", user);
  }

  for (const organization of rows.organizations) {
    const data = asObject(organization.data);
    ensureAccount("organization", text(data.id) || organization.id, "organizations", organization);
  }

  for (const wallet of rows.wallets) {
    const data = asObject(wallet.data);
    const ownerType = normalizeOwnerType(data.ownerType || wallet.owner_type);
    const ownerId = text(data.ownerId) || text(wallet.owner_id);
    const account = ensureAccount(ownerType, ownerId, "wallets", wallet);
    if (account) {
      walletAccountMap.set(text(wallet.id), account.id);
      walletAccountMap.set(text(data.id), account.id);
      walletAccountMap.set(text(legacyUuid("wallet", data.id)), account.id);
    }
  }

  for (const project of rows.projects) {
    const data = asObject(project.data);
    const projectId = firstText(data.id, project.id);
    const ownerType = normalizeOwnerType(firstText(data.ownerType, project.owner_type));
    const ownerId = firstText(data.ownerId, project.owner_id, data.actorId, project.actor_id);
    const account = ensureAccount(ownerType, ownerId, "projects", project);
    if (account && projectId) {
      projectAccountMap.set(projectId, account.id);
      projectAccountMap.set(legacyUuid("project", projectId), account.id);
    }
  }

  const membershipRows = [];
  for (const membership of rows.organization_members) {
    const data = asObject(membership.data);
    const organizationId = text(data.organizationId) || text(membership.organization_id);
    const userId = text(data.userId) || text(membership.user_id);
    const organizationAccountId = resolveAccount(accountMap, "organization", organizationId);
    const userAccountId = resolveAccount(accountMap, "user", userId);
    if (!organizationAccountId || !userAccountId) {
      warnings.push({
        code: "membership-account-missing",
        legacyOrganizationId: organizationId,
        legacyUserId: userId,
      });
      continue;
    }
    membershipRows.push({
      organizationAccountId,
      userAccountId,
      legacyOrganizationId: organizationId,
      legacyUserId: userId,
      role: text(membership.role) || text(data.role) || "member",
      status: text(data.status) || "active",
      data: {
        ...data,
        legacyProjection: {
          sourceTable: "organization_members",
          sourceRowId: text(membership.id),
        },
      },
      createdAt: text(membership.created_at) || text(data.createdAt),
      updatedAt: text(membership.updated_at) || text(data.updatedAt),
    });
  }

  const jobRows = [];
  for (const task of rows.tasks) {
    const data = asObject(task.data);
    const legacyTaskId = text(data.id) || text(task.id);
    const walletId = text(data.walletId) || text(task.wallet_id);
    const actorId = text(data.actorId) || text(task.actor_id);
    const accountId = walletAccountMap.get(walletId) || resolveAccount(accountMap, "user", actorId);
    if (!accountId) {
      warnings.push({ code: "task-account-missing", legacyTaskId, walletId, actorId });
      continue;
    }

    const status = normalizeJobStatus(task.status || data.status);
    const lane = inferLane(task);
    const jobType = text(task.action_code) || text(data.actionCode) || text(task.type) || text(data.type) || "legacy_task";
    const updatedAt = text(task.updated_at) || text(data.updatedAt);
    const terminal = TERMINAL_JOB_STATUSES.has(status);
    const metadata = asObject(data.metadata);
    jobRows.push({
      id: legacyUuid("canonical_job", legacyTaskId),
      accountId,
      createdByUserId: actorId,
      lane,
      jobType,
      providerRoute: text(metadata.model) || text(data.providerRoute),
      status,
      priority: 0,
      idempotencyKey: `legacy:task:${legacyTaskId}`,
      payload: {
        legacyTaskId,
        legacyTaskUuid: text(task.id),
        legacySource: "core-api.tasks",
        legacyStatus: text(task.status) || text(data.status),
        legacyWalletId: walletId,
        legacyActorId: actorId,
        legacyProjectId: text(data.projectId) || text(task.project_id),
        inputSummary: text(data.inputSummary),
        metadata,
      },
      result: {
        legacyOutputSummary: text(data.outputSummary),
        progressPercent: data.progressPercent ?? null,
      },
      maxAttempts: status === "failed" ? 1 : 3,
      timeoutSeconds: Number(data.etaSeconds) > 0 ? Math.max(1800, Number(data.etaSeconds)) : 1800,
      lastError: status === "failed" ? text(data.outputSummary) || text(data.error) : null,
      createdAt: text(task.created_at) || text(data.createdAt),
      updatedAt,
      completedAt: terminal ? updatedAt : null,
      cancelledAt: status === "cancelled" ? updatedAt : null,
    });
  }

  function appendLegacyJob(sourceTable, row, options = {}) {
    const data = asObject(row.data);
    const legacyJobId = firstText(
      data.id,
      data.jobId,
      data.providerJobId,
      data.videoReplaceJobId,
      row.id,
      row.job_id,
      row.legacy_id,
    );
    if (!legacyJobId) return;

    const walletId = firstText(data.walletId, row.wallet_id);
    const actorId = firstText(
      data.actorId,
      data.userId,
      data.createdByUserId,
      data.ownerId,
      row.actor_id,
      row.user_id,
      row.owner_id,
    );
    const ownerType = normalizeOwnerType(firstText(data.ownerType, row.owner_type));
    const accountId = walletAccountMap.get(walletId)
      || resolveAccount(accountMap, ownerType, actorId)
      || ensureAccount(ownerType, actorId, sourceTable, row)?.id;
    if (!accountId) {
      warnings.push({ code: `${sourceTable}-account-missing`, legacyJobId, walletId, actorId });
      return;
    }

    const rawStatus = firstText(row.status, row.stage, data.status, data.stage);
    const status = normalizeJobStatus(rawStatus);
    const updatedAt = firstText(row.updated_at, data.updatedAt);
    const terminal = TERMINAL_JOB_STATUSES.has(status);
    const jobType = firstText(
      data.actionCode,
      data.action_code,
      row.action_code,
      data.jobType,
      row.type,
      data.type,
      options.defaultJobType,
    );
    const idempotencyPrefix = options.idempotencyPrefix || sourceTable.replace(/_/g, "-");
    const payloadLegacyIds = options.payloadLegacyIds || {};
    jobRows.push({
      id: legacyUuid(`canonical_${idempotencyPrefix}`, legacyJobId),
      accountId,
      createdByUserId: actorId,
      lane: options.lane || inferLane({ ...row, data }),
      jobType,
      providerRoute: firstText(data.providerRoute, data.provider, data.model, row.provider, row.model),
      status,
      priority: numberOrZero(row.priority ?? data.priority),
      idempotencyKey: `legacy:${idempotencyPrefix}:${legacyJobId}`,
      payload: {
        ...payloadLegacyIds,
        legacyJobId,
        legacySource: `core-api.${sourceTable}`,
        legacyStatus: rawStatus,
        legacyWalletId: walletId,
        legacyActorId: actorId,
        legacyProjectId: firstText(data.projectId, row.project_id),
        legacyRowId: firstText(row.id, row.job_id, row.legacy_id),
        inputSummary: firstText(data.inputSummary, data.prompt, row.message),
        metadata: {
          ...asObject(data.metadata),
          legacyProjectionData: data,
        },
      },
      result: {
        legacyOutputSummary: firstText(data.outputSummary, data.error, row.error, row.message),
        progressPercent: data.progressPercent ?? data.progress ?? row.progress ?? null,
      },
      maxAttempts: status === "failed" ? 1 : 3,
      timeoutSeconds: Number(data.etaSeconds) > 0 ? Math.max(1800, Number(data.etaSeconds)) : 1800,
      lastError: status === "failed" ? firstText(data.error, row.error, row.message) : null,
      createdAt: firstText(row.created_at, data.createdAt),
      updatedAt,
      completedAt: terminal ? updatedAt : null,
      cancelledAt: status === "cancelled" ? updatedAt : null,
    });
  }

  for (const providerJob of rows.provider_jobs) {
    const data = asObject(providerJob.data);
    const legacyJobId = firstText(data.id, data.providerJobId, providerJob.id, providerJob.job_id, providerJob.legacy_id);
    appendLegacyJob("provider_jobs", providerJob, {
      defaultJobType: "legacy_provider_job",
      idempotencyPrefix: "provider-job",
      lane: "account-media",
      payloadLegacyIds: {
        providerJobId: legacyJobId,
        legacyProviderJobId: legacyJobId,
      },
    });
  }

  for (const videoReplaceJob of rows.video_replace_jobs) {
    const data = asObject(videoReplaceJob.data);
    const legacyJobId = firstText(data.id, data.videoReplaceJobId, videoReplaceJob.legacy_id, videoReplaceJob.job_id);
    appendLegacyJob("video_replace_jobs", videoReplaceJob, {
      defaultJobType: "legacy_video_replace",
      idempotencyPrefix: "video-replace-job",
      lane: "account-media",
      payloadLegacyIds: {
        videoReplaceJobId: legacyJobId,
        legacyVideoReplaceJobId: legacyJobId,
      },
    });
  }

  const mediaRows = [];
  function appendMedia(sourceTable, row, options = {}) {
    const data = asObject(row.data);
    const projectId = firstText(data.projectId, row.project_id);
    const actorId = firstText(data.actorId, row.actor_id, data.userId, data.ownerId, row.owner_id);
    const ownerType = normalizeOwnerType(firstText(data.ownerType, row.owner_type));
    let accountId = projectAccountMap.get(projectId)
      || resolveAccount(accountMap, ownerType, actorId)
      || ensureAccount(ownerType, actorId, sourceTable, row)?.id;
    let ownerFallback = false;
    const legacyId = firstText(data.id, row.id, row.job_id, row.legacy_id);
    if (!accountId) {
      ownerFallback = true;
      accountId = ensureAccount("user", "legacy_projection_unowned_media", "legacy_unowned_media", {
        id: `${sourceTable}:${legacyId || "unknown"}`,
        data: {
          reason: "legacy media row had no project or actor owner",
          sourceTable,
        },
      })?.id;
    }
    if (!legacyId) {
      warnings.push({ code: `${sourceTable}-media-id-missing`, projectId, actorId });
      return;
    }

    const sourceUrl = firstText(
      options.sourceUrl,
      data.url,
      data.src,
      data.sourceUrl,
      data.fileUrl,
      data.imageUrl,
      data.image_url,
      row.image_url,
      data.videoUrl,
      data.video_url,
      row.video_url,
      data.audioUrl,
      data.audio_url,
      row.audio_url,
    );
    const mediaType = firstText(options.mediaType, data.mediaType, row.media_type)
      || inferMediaTypeFromUrl(sourceUrl, options.fallbackMediaType || "file");
    const bucket = firstText(process.env.OBJECT_STORAGE_BUCKET, data.bucket, row.bucket) || "legacy-projection";
    const explicitObjectKey = firstText(
      data.objectKey,
      data.object_key,
      data.permanentObjectKey,
      data.permanent_object_key,
      row.object_key,
      row.permanent_object_key,
    );
    const objectKey = explicitObjectKey
      ? safePathSegment(explicitObjectKey)
      : `legacy/${safePathSegment(sourceTable)}/${safePathSegment(legacyId)}`;
    const permanentObjectKey = firstText(data.permanentObjectKey, data.permanent_object_key, row.permanent_object_key)
      || objectKey;

    mediaRows.push({
      id: legacyUuid("canonical_media_object", `${sourceTable}:${legacyId}`),
      accountId,
      bucket,
      objectKey,
      permanentObjectKey,
      mediaType,
      contentType: firstText(data.contentType, data.content_type, row.content_type),
      byteSize: Number.isFinite(Number(data.byteSize ?? data.byte_size ?? row.byte_size))
        ? Number(data.byteSize ?? data.byte_size ?? row.byte_size)
        : null,
      checksumSha256: firstText(data.checksumSha256, data.checksum_sha256, row.checksum_sha256),
      status: "permanent",
      dataSensitivity: firstText(data.dataSensitivity, data.data_sensitivity, row.data_sensitivity) || "normal",
      data: {
        ...data,
        sourceUrl,
        legacyProjection: {
          sourceTable,
          sourceRowId: firstText(row.id, row.job_id, row.legacy_id),
          legacyProjectId: projectId,
          legacyActorId: actorId,
          ownerFallback,
        },
      },
      createdAt: firstText(row.created_at, data.createdAt),
      updatedAt: firstText(row.updated_at, data.updatedAt),
    });
  }

  for (const asset of rows.project_assets) {
    appendMedia("project_assets", asset, { mediaType: firstText(asset.asset_type, asObject(asset.data).assetType) });
  }
  for (const video of rows.videos) {
    appendMedia("videos", video, { fallbackMediaType: "video", sourceUrl: firstText(video.video_url, asObject(video.data).videoUrl) });
  }
  for (const dubbing of rows.dubbings) {
    appendMedia("dubbings", dubbing, { fallbackMediaType: "audio", sourceUrl: firstText(dubbing.audio_url, asObject(dubbing.data).audioUrl) });
  }
  for (const image of rows.create_studio_images) {
    appendMedia("create_studio_images", image, { fallbackMediaType: "image", sourceUrl: firstText(image.image_url, asObject(image.data).imageUrl) });
  }
  for (const video of rows.create_studio_videos) {
    appendMedia("create_studio_videos", video, { fallbackMediaType: "video", sourceUrl: firstText(video.video_url, asObject(video.data).videoUrl) });
  }

  const ledgerRows = [];
  const balances = new Map();
  const sortedLedger = [...rows.wallet_ledger].sort((left, right) => {
    const leftTime = text(left.created_at) || "";
    const rightTime = text(right.created_at) || "";
    if (leftTime !== rightTime) return leftTime.localeCompare(rightTime);
    return String(left.id || "").localeCompare(String(right.id || ""));
  });

  for (const entry of sortedLedger) {
    const data = asObject(entry.data);
    const walletId = text(data.walletId) || text(entry.wallet_id);
    const actorId = text(data.actorId) || text(entry.actor_id);
    const accountId = walletAccountMap.get(walletId) || resolveAccount(accountMap, "user", actorId);
    if (!accountId) {
      warnings.push({ code: "ledger-account-missing", ledgerId: text(entry.id), walletId, actorId });
      continue;
    }

    const currency = text(data.currency) || text(entry.currency) || "CNY";
    const balanceKey = `${accountId}:${currency}`;
    const current = balances.get(balanceKey) || {
      accountId,
      currency,
      balanceCents: 0n,
      creditBalance: 0,
      ledgerVersion: 0,
    };
    const amount = numberOrZero(entry.amount ?? data.amount);
    const amountCents = BigInt(centsString(amount));
    current.balanceCents += amountCents;
    current.creditBalance += amount;
    current.ledgerVersion += 1;
    balances.set(balanceKey, current);

    ledgerRows.push({
      id: text(entry.id),
      accountId,
      currency,
      amountCents: amountCents.toString(),
      creditAmount: decimalString(amount),
      balanceAfterCents: current.balanceCents.toString(),
      balanceAfterCredits: decimalString(current.creditBalance),
      sourceType: "legacy_wallet_ledger",
      sourceId: text(entry.id),
      idempotencyKey: `legacy:wallet-ledger:${entry.id}`,
      data: {
        ...data,
        legacyProjection: {
          sourceTable: "wallet_ledger",
          sourceRowId: text(entry.id),
          legacySourceType: text(entry.source_type),
          legacySourceId: text(entry.source_id),
          legacyWalletId: walletId,
          legacyActorId: actorId,
        },
      },
    });
  }

  const paymentOrderRows = [];
  for (const order of rows.wallet_recharge_orders) {
    const data = asObject(order.data);
    const legacyOrderId = text(data.id) || text(order.id);
    const status = normalizePaymentStatus(order.status || data.status);
    if (status !== "paid") continue;
    const walletId = text(data.walletId) || text(order.wallet_id);
    const actorId = text(data.actorId) || text(order.actor_id);
    const accountId = walletAccountMap.get(walletId) || resolveAccount(accountMap, "user", actorId);
    if (!accountId) {
      warnings.push({ code: "payment-order-account-missing", legacyOrderId, walletId, actorId });
      continue;
    }
    const amount = Number(order.amount ?? data.amount ?? data.payAmount ?? 0);
    const credits = Number(order.credits ?? data.credits ?? data.creditAmount ?? amount);
    const provider = text(data.provider) || text(order.payment_method) || "legacy";
    const merchantOrderNo = text(data.merchantOrderNo) || text(data.merchant_order_no) || `legacy:${legacyOrderId}`;
    paymentOrderRows.push({
      id: legacyUuid("canonical_payment_order", legacyOrderId),
      accountId,
      legacyRechargeOrderId: legacyOrderId,
      provider,
      merchantOrderNo,
      providerTradeNo: text(order.provider_trade_no) || text(data.providerTradeNo),
      idempotencyKey: `legacy:wallet-recharge-order:${legacyOrderId}`,
      status,
      amountCents: centsString(amount),
      creditAmount: decimalString(credits),
      currency: text(data.currency) || "CNY",
      paidAt: text(data.paidAt) || text(order.updated_at) || text(data.updatedAt),
      data: {
        ...data,
        legacyProjection: {
          sourceTable: "wallet_recharge_orders",
          sourceRowId: text(order.id),
        },
      },
      createdAt: text(order.created_at) || text(data.createdAt),
      updatedAt: text(order.updated_at) || text(data.updatedAt),
    });
  }

  const callbackRows = [];
  for (const event of rows.payment_events) {
    const data = asObject(event.data);
    const provider = text(data.provider) || text(event.provider) || text(event.payment_method) || "legacy";
    const eventId = text(data.eventId) || text(data.id) || text(event.event_id) || text(event.id);
    if (!eventId) continue;
    const verified = event.verified === true || String(event.verified).toLowerCase() === "true" || data.verified === true;
    callbackRows.push({
      id: legacyUuid("canonical_payment_callback", `${provider}:${eventId}`),
      provider,
      eventId,
      merchantOrderNo: text(data.merchantOrderNo) || text(event.merchant_order_no),
      providerTradeNo: text(data.providerTradeNo) || text(event.provider_trade_no),
      signatureValid: verified,
      processingStatus: verified ? "processed" : "received",
      rawBodyHash: text(data.rawBodyHash) || sha256Json(data),
      data: {
        ...data,
        legacyProjection: {
          sourceTable: "payment_events",
          sourceRowId: text(event.id),
        },
      },
      receivedAt: text(event.created_at) || text(data.createdAt),
      processedAt: verified ? text(event.updated_at) || text(data.updatedAt) : null,
      error: text(data.error) || text(event.error),
    });
  }

  return {
    accounts: Array.from(accountsByKey.values()),
    accountMap,
    walletAccountMap,
    memberships: membershipRows,
    jobs: jobRows,
    ledgerRows,
    walletBalances: Array.from(balances.values()),
    paymentOrders: paymentOrderRows,
    paymentCallbacks: callbackRows,
    mediaObjects: mediaRows,
    warnings,
  };
}

async function insertAccounts(client, accounts) {
  for (const account of accounts) {
    await client.query(
      `INSERT INTO accounts
         (id, account_type, legacy_owner_type, legacy_owner_id, status, region_code, default_currency, data, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,coalesce($9::timestamptz, now()),coalesce($10::timestamptz, now()))
       ON CONFLICT (legacy_owner_type, legacy_owner_id)
         WHERE legacy_owner_type IS NOT NULL AND legacy_owner_id IS NOT NULL
       DO UPDATE SET
         account_type = excluded.account_type,
         status = excluded.status,
         region_code = excluded.region_code,
         default_currency = excluded.default_currency,
         data = accounts.data || excluded.data,
         updated_at = now()`,
      [
        account.id,
        account.accountType,
        account.legacyOwnerType,
        account.legacyOwnerId,
        account.status,
        account.regionCode,
        account.defaultCurrency,
        JSON.stringify(account.data),
        account.createdAt,
        account.updatedAt,
      ],
    );
  }
}

async function updateLegacyAccountRefs(client, accounts, rows) {
  const usersColumns = await getColumns(client, "users");
  if (usersColumns.has("account_id")) {
    for (const user of rows.users) {
      const data = asObject(user.data);
      const accountId = resolveAccount(accounts.accountMap, "user", text(data.id) || text(user.id));
      if (!accountId) continue;
      await client.query("UPDATE users SET account_id = $1 WHERE id = $2", [accountId, user.id]);
    }
  }

  const organizationColumns = await getColumns(client, "organizations");
  if (organizationColumns.has("account_id")) {
    for (const organization of rows.organizations) {
      const data = asObject(organization.data);
      const accountId = resolveAccount(accounts.accountMap, "organization", text(data.id) || text(organization.id));
      if (!accountId) continue;
      await client.query("UPDATE organizations SET account_id = $1 WHERE id = $2", [accountId, organization.id]);
    }
  }
}

async function upsertMemberships(client, memberships) {
  for (const membership of memberships) {
    await client.query(
      `INSERT INTO organization_memberships
         (organization_account_id, user_account_id, legacy_organization_id, legacy_user_id, role, status, data, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,coalesce($8::timestamptz, now()),coalesce($9::timestamptz, now()))
       ON CONFLICT (organization_account_id, user_account_id) DO UPDATE SET
         legacy_organization_id = excluded.legacy_organization_id,
         legacy_user_id = excluded.legacy_user_id,
         role = excluded.role,
         status = excluded.status,
         data = organization_memberships.data || excluded.data,
         updated_at = now()`,
      [
        membership.organizationAccountId,
        membership.userAccountId,
        membership.legacyOrganizationId,
        membership.legacyUserId,
        membership.role,
        membership.status,
        JSON.stringify(membership.data),
        membership.createdAt,
        membership.updatedAt,
      ],
    );
  }
}

async function upsertJobs(client, jobs) {
  for (const job of jobs) {
    await client.query(
      `INSERT INTO jobs
         (id, account_id, created_by_user_id, lane, job_type, provider_route, status, priority, idempotency_key,
          payload, result, run_after, attempt_count, max_attempts, timeout_seconds, last_error, created_at, updated_at,
          completed_at, cancelled_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7::job_status,$8,$9,$10::jsonb,$11::jsonb,coalesce($12::timestamptz, now()),
          0,$13,$14,$15,coalesce($16::timestamptz, now()),coalesce($17::timestamptz, now()),$18::timestamptz,$19::timestamptz)
       ON CONFLICT (id) DO UPDATE SET
         account_id = excluded.account_id,
         created_by_user_id = excluded.created_by_user_id,
         lane = excluded.lane,
         job_type = excluded.job_type,
         provider_route = excluded.provider_route,
         status = excluded.status,
         idempotency_key = excluded.idempotency_key,
         payload = jobs.payload || excluded.payload,
         result = jobs.result || excluded.result,
         max_attempts = excluded.max_attempts,
         timeout_seconds = excluded.timeout_seconds,
         last_error = excluded.last_error,
         updated_at = now(),
         completed_at = excluded.completed_at,
         cancelled_at = excluded.cancelled_at`,
      [
        job.id,
        job.accountId,
        job.createdByUserId,
        job.lane,
        job.jobType,
        job.providerRoute,
        job.status,
        job.priority,
        job.idempotencyKey,
        JSON.stringify(job.payload),
        JSON.stringify(job.result),
        job.createdAt,
        job.maxAttempts,
        job.timeoutSeconds,
        job.lastError,
        job.createdAt,
        job.updatedAt,
        job.completedAt,
        job.cancelledAt,
      ],
    );
  }
}

async function updateWalletLedger(client, ledgerRows) {
  for (const entry of ledgerRows) {
    await client.query(
      `UPDATE wallet_ledger SET
         account_id = $1,
         currency = $2,
         amount_cents = $3,
         credit_amount = $4,
         balance_after_cents = $5,
         balance_after_credits = $6,
         source_type = $7,
         source_id = $8,
         idempotency_key = $9,
         immutable = true,
         data = data || $10::jsonb
       WHERE id = $11`,
      [
        entry.accountId,
        entry.currency,
        entry.amountCents,
        entry.creditAmount,
        entry.balanceAfterCents,
        entry.balanceAfterCredits,
        entry.sourceType,
        entry.sourceId,
        entry.idempotencyKey,
        JSON.stringify(entry.data),
        entry.id,
      ],
    );
  }
}

async function upsertWalletBalances(client, balances) {
  for (const balance of balances) {
    await client.query(
      `INSERT INTO wallet_balances
         (account_id, currency, balance_cents, credit_balance, ledger_version, updated_at)
       VALUES ($1,$2,$3,$4,$5,now())
       ON CONFLICT (account_id, currency) DO UPDATE SET
         balance_cents = excluded.balance_cents,
         credit_balance = excluded.credit_balance,
         ledger_version = excluded.ledger_version,
         updated_at = now()`,
      [
        balance.accountId,
        balance.currency,
        balance.balanceCents.toString(),
        decimalString(balance.creditBalance),
        balance.ledgerVersion,
      ],
    );
  }
}

async function upsertPaymentOrders(client, orders) {
  for (const order of orders) {
    await client.query(
      `INSERT INTO payment_orders
         (id, account_id, legacy_recharge_order_id, provider, merchant_order_no, provider_trade_no,
          idempotency_key, status, amount_cents, credit_amount, currency, paid_at, data, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::payment_order_status,$9,$10,$11,$12::timestamptz,$13::jsonb,
          coalesce($14::timestamptz, now()), coalesce($15::timestamptz, now()))
       ON CONFLICT (legacy_recharge_order_id)
         WHERE legacy_recharge_order_id IS NOT NULL
       DO UPDATE SET
         account_id = excluded.account_id,
         provider = excluded.provider,
         merchant_order_no = excluded.merchant_order_no,
         provider_trade_no = excluded.provider_trade_no,
         idempotency_key = excluded.idempotency_key,
         status = excluded.status,
         amount_cents = excluded.amount_cents,
         credit_amount = excluded.credit_amount,
         currency = excluded.currency,
         paid_at = excluded.paid_at,
         data = payment_orders.data || excluded.data,
         updated_at = now()`,
      [
        order.id,
        order.accountId,
        order.legacyRechargeOrderId,
        order.provider,
        order.merchantOrderNo,
        order.providerTradeNo,
        order.idempotencyKey,
        order.status,
        order.amountCents,
        order.creditAmount,
        order.currency,
        order.paidAt,
        JSON.stringify(order.data),
        order.createdAt,
        order.updatedAt,
      ],
    );
  }
}

async function upsertPaymentCallbacks(client, callbacks) {
  for (const callback of callbacks) {
    await client.query(
      `INSERT INTO payment_callbacks
         (id, provider, event_id, merchant_order_no, provider_trade_no, signature_valid,
          processing_status, raw_body_hash, data, received_at, processed_at, error)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,coalesce($10::timestamptz, now()),$11::timestamptz,$12)
       ON CONFLICT (provider, event_id) DO UPDATE SET
         merchant_order_no = excluded.merchant_order_no,
         provider_trade_no = excluded.provider_trade_no,
         signature_valid = excluded.signature_valid,
         processing_status = excluded.processing_status,
         raw_body_hash = excluded.raw_body_hash,
         data = payment_callbacks.data || excluded.data,
         processed_at = excluded.processed_at,
         error = excluded.error`,
      [
        callback.id,
        callback.provider,
        callback.eventId,
        callback.merchantOrderNo,
        callback.providerTradeNo,
        callback.signatureValid,
        callback.processingStatus,
        callback.rawBodyHash,
        JSON.stringify(callback.data),
        callback.receivedAt,
        callback.processedAt,
        callback.error,
      ],
    );
  }
}

async function upsertMediaObjects(client, mediaObjects) {
  for (const media of mediaObjects) {
    await client.query(
      `INSERT INTO media_objects
         (id, account_id, bucket, object_key, permanent_object_key, storage_class, media_type,
          content_type, byte_size, checksum_sha256, status, data_sensitivity, data, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,'standard',$6,$7,$8,$9,$10,$11,$12::jsonb,
          coalesce($13::timestamptz, now()), coalesce($14::timestamptz, now()))
       ON CONFLICT (bucket, object_key) DO UPDATE SET
         account_id = excluded.account_id,
         permanent_object_key = excluded.permanent_object_key,
         media_type = excluded.media_type,
         content_type = excluded.content_type,
         byte_size = excluded.byte_size,
         checksum_sha256 = excluded.checksum_sha256,
         status = excluded.status,
         data_sensitivity = excluded.data_sensitivity,
         data = media_objects.data || excluded.data,
         updated_at = now()`,
      [
        media.id,
        media.accountId,
        media.bucket,
        media.objectKey,
        media.permanentObjectKey,
        media.mediaType,
        media.contentType,
        media.byteSize,
        media.checksumSha256,
        media.status,
        media.dataSensitivity,
        JSON.stringify(media.data),
        media.createdAt,
        media.updatedAt,
      ],
    );
  }
}

async function executeProjection(client, projection, rows) {
  await insertAccounts(client, projection.accounts);
  await updateLegacyAccountRefs(client, projection, rows);
  await upsertMemberships(client, projection.memberships);
  await upsertJobs(client, projection.jobs);
  await updateWalletLedger(client, projection.ledgerRows);
  await upsertWalletBalances(client, projection.walletBalances);
  await upsertPaymentOrders(client, projection.paymentOrders);
  await upsertPaymentCallbacks(client, projection.paymentCallbacks);
  await upsertMediaObjects(client, projection.mediaObjects);
}

function summarizeRows(rows) {
  return Object.fromEntries(Object.entries(rows).map(([name, value]) => [name, value.length]));
}

function summarizeProjection(projection) {
  return {
    accounts: projection.accounts.length,
    organizationMemberships: projection.memberships.length,
    jobs: projection.jobs.length,
    walletLedgerRows: projection.ledgerRows.length,
    walletBalances: projection.walletBalances.length,
    paymentOrders: projection.paymentOrders.length,
    paymentCallbacks: projection.paymentCallbacks.length,
    mediaObjects: projection.mediaObjects.length,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const databaseUrl = args.databaseUrl || process.env.DATABASE_URL || DEFAULT_DATABASE_URL;
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  const client = await pool.connect();
  try {
    const schema = await currentSchema(client);
    if (args.execute && !args.allowNonStaging && !schema.startsWith("legacy_projection_staging_")) {
      throw new Error(
        `Refusing to execute projection in schema '${schema}'. Use a legacy_projection_staging_* schema or pass --allow-non-staging after a production freeze.`,
      );
    }

    const rows = {
      users: await readRows(client, "users"),
      organizations: await readRows(client, "organizations"),
      organization_members: await readRows(client, "organization_members"),
      wallets: await readRows(client, "wallets"),
      wallet_ledger: await readRows(client, "wallet_ledger", "created_at, id"),
      wallet_recharge_orders: await readRows(client, "wallet_recharge_orders", "created_at, id"),
      payment_events: await readRows(client, "payment_events", "created_at, id"),
      tasks: await readRows(client, "tasks", "created_at, id"),
      provider_jobs: await readRows(client, "provider_jobs", "created_at, id"),
      video_replace_jobs: await readRows(client, "video_replace_jobs", "created_at, job_id"),
      projects: await readRows(client, "projects", "created_at, id"),
      project_assets: await readRows(client, "project_assets", "created_at, id"),
      videos: await readRows(client, "videos", "created_at, id"),
      dubbings: await readRows(client, "dubbings", "created_at, id"),
      create_studio_images: await readRows(client, "create_studio_images", "created_at, id"),
      create_studio_videos: await readRows(client, "create_studio_videos", "created_at, id"),
    };
    const projection = buildProjection(rows);

    const report = {
      generatedAt: new Date().toISOString(),
      databaseUrl: redactDatabaseUrl(databaseUrl),
      schema,
      mode: args.execute ? "execute" : "dry-run",
      legacyRows: summarizeRows(rows),
      planned: summarizeProjection(projection),
      warnings: projection.warnings,
    };

    if (args.execute) {
      await client.query("BEGIN");
      try {
        await executeProjection(client, projection, rows);
        await client.query("COMMIT");
        report.executed = summarizeProjection(projection);
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }

    const textReport = JSON.stringify(report, null, 2);
    if (args.reportPath) {
      const reportPath = resolve(args.reportPath);
      mkdirSync(dirname(reportPath), { recursive: true });
      writeFileSync(reportPath, `${textReport}\n`, "utf8");
    }
    console.log(textReport);

    if (projection.warnings.length > 0) {
      process.exitCode = 2;
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
