const { randomUUID } = require("node:crypto");
const {
  ensureAccountForLegacyOwner,
  lockAccountLane,
} = require("../accounts/account-lanes");
const { accountIdForActor } = require("../accounts/canonical-ids");

const DEFAULT_UPLOAD_TTL_SECONDS = 15 * 60;
const DEFAULT_READ_TTL_SECONDS = 10 * 60;

function objectStorageConfig() {
  return {
    provider: String(process.env.OBJECT_STORAGE_PROVIDER || "external-signer").trim(),
    bucket: String(process.env.OBJECT_STORAGE_BUCKET || "xiaolou-media").trim(),
    region: String(process.env.OBJECT_STORAGE_REGION || "CN").trim(),
    endpoint: String(process.env.OBJECT_STORAGE_ENDPOINT || "").trim(),
    signedUploadUrlBase: String(process.env.OBJECT_STORAGE_SIGNED_UPLOAD_URL_BASE || "").trim(),
    signedReadUrlBase: String(process.env.OBJECT_STORAGE_SIGNED_READ_URL_BASE || "").trim(),
  };
}

function normalizeJson(value) {
  return JSON.stringify(value && typeof value === "object" ? value : {});
}

function normalizeSensitivity(value) {
  const normalized = String(value || "normal").trim().toLowerCase();
  return ["public", "normal", "sensitive", "restricted"].includes(normalized)
    ? normalized
    : "normal";
}

function normalizeMediaType(value) {
  const normalized = String(value || "other").trim().toLowerCase();
  return ["image", "video", "audio", "mask", "other"].includes(normalized)
    ? normalized
    : "other";
}

function expiresAt(ttlSeconds) {
  return new Date(Date.now() + Math.max(1, Number(ttlSeconds) || DEFAULT_UPLOAD_TTL_SECONDS) * 1000);
}

function buildObjectKey({ accountId, mediaType, extension = "bin", prefix = "temp" }) {
  const safeExtension = String(extension || "bin").replace(/^\./, "").replace(/[^\w-]+/g, "") || "bin";
  const now = new Date();
  const datePart = [
    now.getUTCFullYear(),
    String(now.getUTCMonth() + 1).padStart(2, "0"),
    String(now.getUTCDate()).padStart(2, "0"),
  ].join("/");
  return `${prefix}/${accountId}/${mediaType}/${datePart}/${randomUUID()}.${safeExtension}`;
}

function signedUrl(base, objectKey, expires) {
  if (!base) return null;
  const url = new URL(base);
  url.searchParams.set("object_key", objectKey);
  url.searchParams.set("expires_at", expires.toISOString());
  return url.toString();
}

async function beginUpload(pool, input = {}) {
  const config = objectStorageConfig();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const accountId = input.accountId || accountIdForActor(input.actorId || "guest");
    const account = await ensureAccountForLegacyOwner(client, input.ownerType || "user", input.actorId || "guest", {
      accountId,
    });
    await lockAccountLane(client, account.id, "account-media");

    const mediaType = normalizeMediaType(input.mediaType);
    const idempotencyKey = String(input.idempotencyKey || randomUUID()).trim();
    const uploadExpiresAt = expiresAt(input.expiresInSeconds || DEFAULT_UPLOAD_TTL_SECONDS);
    const objectKey = buildObjectKey({
      accountId: account.id,
      mediaType,
      extension: input.extension || "bin",
      prefix: "temp",
    });

    const existingSession = (
      await client.query(
        `SELECT us.*, mo.object_key, mo.bucket
         FROM upload_sessions us
         JOIN media_objects mo ON mo.id = us.media_object_id
         WHERE us.account_id = $1 AND us.idempotency_key = $2
         LIMIT 1`,
        [account.id, idempotencyKey],
      )
    ).rows[0];

    if (existingSession) {
      await client.query("COMMIT");
      return {
        uploadSessionId: existingSession.id,
        mediaObjectId: existingSession.media_object_id,
        bucket: existingSession.bucket,
        objectKey: existingSession.object_key,
        signedUploadUrl: signedUrl(config.signedUploadUrlBase, existingSession.object_key, uploadExpiresAt),
        expiresAt: uploadExpiresAt.toISOString(),
        requiresExternalSigner: !config.signedUploadUrlBase,
      };
    }

    const mediaObject = (
      await client.query(
        `INSERT INTO media_objects (
           account_id,
           bucket,
           object_key,
           media_type,
           content_type,
           byte_size,
           checksum_sha256,
           status,
           data_sensitivity,
           data
         )
         VALUES ($1,$2,$3,$4,$5,$6,$7,'temporary',$8,$9::jsonb)
         RETURNING *`,
        [
          account.id,
          config.bucket,
          objectKey,
          mediaType,
          input.contentType || null,
          input.byteSize || null,
          input.checksumSha256 || null,
          normalizeSensitivity(input.dataSensitivity),
          normalizeJson({ provider: config.provider, region: config.region }),
        ],
      )
    ).rows[0];

    const uploadSession = (
      await client.query(
        `INSERT INTO upload_sessions (
           account_id,
           media_object_id,
           idempotency_key,
           status,
           upload_url_expires_at,
           data
         )
         VALUES ($1,$2,$3,'begun',$4,$5::jsonb)
         RETURNING *`,
        [
          account.id,
          mediaObject.id,
          idempotencyKey,
          uploadExpiresAt,
          normalizeJson({ contentType: input.contentType || null }),
        ],
      )
    ).rows[0];

    await client.query("COMMIT");
    return {
      uploadSessionId: uploadSession.id,
      mediaObjectId: mediaObject.id,
      bucket: mediaObject.bucket,
      objectKey: mediaObject.object_key,
      signedUploadUrl: signedUrl(config.signedUploadUrlBase, mediaObject.object_key, uploadExpiresAt),
      expiresAt: uploadExpiresAt.toISOString(),
      requiresExternalSigner: !config.signedUploadUrlBase,
    };
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {}
    throw error;
  } finally {
    client.release();
  }
}

async function completeUpload(pool, input = {}) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const session = (
      await client.query(
        `SELECT us.*, mo.account_id
         FROM upload_sessions us
         JOIN media_objects mo ON mo.id = us.media_object_id
         WHERE us.id = $1
         FOR UPDATE`,
        [input.uploadSessionId],
      )
    ).rows[0];
    if (!session) {
      const error = new Error("upload session not found");
      error.statusCode = 404;
      error.code = "UPLOAD_SESSION_NOT_FOUND";
      throw error;
    }
    await lockAccountLane(client, session.account_id, "account-media");
    await client.query(
      `UPDATE media_objects
       SET byte_size = COALESCE($2, byte_size),
           checksum_sha256 = COALESCE($3, checksum_sha256),
           status = 'temporary',
           updated_at = now()
       WHERE id = $1`,
      [session.media_object_id, input.actualByteSize || null, input.checksumSha256 || null],
    );
    const updated = (
      await client.query(
        `UPDATE upload_sessions
         SET status = 'completed',
             completed_at = now()
         WHERE id = $1
         RETURNING *`,
        [input.uploadSessionId],
      )
    ).rows[0];
    await client.query("COMMIT");
    return {
      uploadSessionId: updated.id,
      mediaObjectId: updated.media_object_id,
      status: "temporary",
    };
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {}
    throw error;
  } finally {
    client.release();
  }
}

async function getSignedReadUrl(pool, input = {}) {
  const config = objectStorageConfig();
  const result = await pool.query(
    "SELECT * FROM media_objects WHERE id = $1 AND account_id = $2",
    [input.mediaObjectId, input.accountId],
  );
  const mediaObject = result.rows[0];
  if (!mediaObject) {
    const error = new Error("media object not found");
    error.statusCode = 404;
    error.code = "MEDIA_OBJECT_NOT_FOUND";
    throw error;
  }
  const readExpiresAt = expiresAt(input.expiresInSeconds || DEFAULT_READ_TTL_SECONDS);
  const objectKey = mediaObject.permanent_object_key || mediaObject.object_key;
  return {
    mediaObjectId: mediaObject.id,
    bucket: mediaObject.bucket,
    objectKey,
    signedReadUrl: signedUrl(config.signedReadUrlBase, objectKey, readExpiresAt),
    expiresAt: readExpiresAt.toISOString(),
    requiresExternalSigner: !config.signedReadUrlBase,
  };
}

async function moveTempToPermanent(pool, input = {}) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const mediaObject = (
      await client.query("SELECT * FROM media_objects WHERE id = $1 FOR UPDATE", [input.mediaObjectId])
    ).rows[0];
    if (!mediaObject) {
      const error = new Error("media object not found");
      error.statusCode = 404;
      error.code = "MEDIA_OBJECT_NOT_FOUND";
      throw error;
    }
    await lockAccountLane(client, mediaObject.account_id, "account-media");
    const permanentPrefix = String(input.permanentPrefix || "permanent").replace(/^\/+|\/+$/g, "");
    const permanentObjectKey = `${permanentPrefix}/${mediaObject.object_key.replace(/^temp\//, "")}`;
    const updated = (
      await client.query(
        `UPDATE media_objects
         SET permanent_object_key = $2,
             status = 'permanent',
             data = data || $3::jsonb,
             updated_at = now()
         WHERE id = $1
         RETURNING *`,
        [
          mediaObject.id,
          permanentObjectKey,
          normalizeJson({ permanentReason: input.reason || "job-result" }),
        ],
      )
    ).rows[0];
    await client.query("COMMIT");
    return {
      mediaObjectId: updated.id,
      bucket: updated.bucket,
      objectKey: updated.object_key,
      permanentObjectKey: updated.permanent_object_key,
      status: updated.status,
    };
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {}
    throw error;
  } finally {
    client.release();
  }
}

async function cleanupTemp(pool, input = {}) {
  const olderThanHours = Math.max(1, Number(input.olderThanHours || 24));
  const query = input.dryRun
    ? `SELECT * FROM media_objects
       WHERE status = 'temporary'
         AND created_at < now() - make_interval(hours => $1)
       ORDER BY created_at ASC
       LIMIT 500`
    : `UPDATE media_objects
       SET status = 'cleanup_pending', updated_at = now()
       WHERE status = 'temporary'
         AND created_at < now() - make_interval(hours => $1)
       RETURNING *`;
  const result = await pool.query(query, [olderThanHours]);
  return {
    scanned: result.rows.length,
    marked: input.dryRun ? 0 : result.rows.length,
    dryRun: Boolean(input.dryRun),
    items: result.rows,
  };
}

module.exports = {
  beginUpload,
  cleanupTemp,
  completeUpload,
  getSignedReadUrl,
  moveTempToPermanent,
  objectStorageConfig,
};
