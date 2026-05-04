const { randomUUID } = require("node:crypto");
const {
  assertAccountLane,
  ensureAccountForLegacyOwner,
  lockAccountLane,
} = require("../accounts/account-lanes");

const TERMINAL_JOB_STATUSES = new Set(["succeeded", "failed", "cancelled"]);

function normalizeJson(value) {
  return JSON.stringify(value && typeof value === "object" ? value : {});
}

function normalizePositiveInteger(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? Math.floor(numeric) : fallback;
}

function normalizePriority(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.floor(numeric) : 0;
}

async function createJob(pool, input = {}) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const ownerType = input.accountOwnerType || input.ownerType || "user";
    const ownerId = input.accountOwnerId || input.ownerId || input.actorId || "guest";
    const account = await ensureAccountForLegacyOwner(client, ownerType, ownerId, {
      accountId: input.accountId,
      regionCode: input.regionCode,
      currency: input.currency,
    });

    await lockAccountLane(client, account.id, "account-control");

    const lane = assertAccountLane(input.lane || "account-media");
    const idempotencyKey = input.idempotencyKey ? String(input.idempotencyKey).trim() : null;
    const values = [
      account.id,
      input.actorId ? String(input.actorId) : null,
      lane,
      String(input.jobType || input.type || "generic"),
      input.providerRoute ? String(input.providerRoute) : null,
      idempotencyKey,
      normalizeJson(input.payload),
      normalizePriority(input.priority),
      normalizePositiveInteger(input.maxAttempts, 3),
      normalizePositiveInteger(input.timeoutSeconds, 1800),
      input.runAfter ? new Date(input.runAfter) : new Date(),
    ];

    const insertSql = idempotencyKey
      ? `INSERT INTO jobs (
           account_id,
           created_by_user_id,
           lane,
           job_type,
           provider_route,
           idempotency_key,
           payload,
           priority,
           max_attempts,
           timeout_seconds,
           run_after
         )
         VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11)
         ON CONFLICT (account_id, lane, idempotency_key)
         WHERE idempotency_key IS NOT NULL
         DO UPDATE SET updated_at = jobs.updated_at
         RETURNING *`
      : `INSERT INTO jobs (
           account_id,
           created_by_user_id,
           lane,
           job_type,
           provider_route,
           idempotency_key,
           payload,
           priority,
           max_attempts,
           timeout_seconds,
           run_after
         )
         VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11)
         RETURNING *`;

    const job = (await client.query(insertSql, values)).rows[0];

    await client.query(
      `INSERT INTO outbox_events (aggregate_type, aggregate_id, event_type, payload)
       VALUES ('job', $1, 'job.created', $2::jsonb)
       ON CONFLICT DO NOTHING`,
      [job.id, normalizeJson({ jobId: job.id, accountId: account.id, lane: job.lane })],
    );
    await client.query("SELECT pg_notify('xiaolou_jobs', $1)", [
      JSON.stringify({ job_id: job.id, account_id: account.id, lane: job.lane, status: job.status }),
    ]);

    await client.query("COMMIT");
    return job;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {}
    throw error;
  } finally {
    client.release();
  }
}

async function getJob(pool, jobId) {
  const result = await pool.query("SELECT * FROM jobs WHERE id = $1", [jobId]);
  return result.rows[0] || null;
}

async function listJobs(pool, { accountId, lane, status, limit = 50 } = {}) {
  const filters = [];
  const values = [];
  if (accountId) {
    values.push(accountId);
    filters.push(`account_id = $${values.length}`);
  }
  if (lane) {
    values.push(assertAccountLane(lane));
    filters.push(`lane = $${values.length}`);
  }
  if (status) {
    values.push(String(status));
    filters.push(`status = $${values.length}`);
  }
  values.push(Math.min(Math.max(Number(limit) || 50, 1), 200));
  const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
  const result = await pool.query(
    `SELECT * FROM jobs ${where} ORDER BY created_at DESC LIMIT $${values.length}`,
    values,
  );
  return result.rows;
}

async function leaseJobs(pool, { lane, workerId, batchSize = 1, leaseSeconds = 300 } = {}) {
  const normalizedLane = assertAccountLane(lane || "account-media");
  const normalizedWorkerId = String(workerId || `worker-${randomUUID()}`);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `WITH picked AS (
         SELECT id
         FROM jobs
         WHERE lane = $1
           AND status IN ('queued', 'retry_waiting')
           AND run_after <= now()
         ORDER BY priority DESC, run_after ASC, created_at ASC
         FOR UPDATE SKIP LOCKED
         LIMIT $2
       )
       UPDATE jobs AS j
       SET status = 'leased',
           lease_owner = $3,
           lease_until = now() + make_interval(secs => $4),
           updated_at = now()
       FROM picked
       WHERE j.id = picked.id
       RETURNING j.*`,
      [
        normalizedLane,
        normalizePositiveInteger(batchSize, 1),
        normalizedWorkerId,
        normalizePositiveInteger(leaseSeconds, 300),
      ],
    );
    await client.query("COMMIT");
    return result.rows;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {}
    throw error;
  } finally {
    client.release();
  }
}

async function markJobRunning(pool, jobId, workerId) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const job = (
      await client.query("SELECT * FROM jobs WHERE id = $1 FOR UPDATE", [jobId])
    ).rows[0];
    if (!job) {
      await client.query("COMMIT");
      return null;
    }
    if (TERMINAL_JOB_STATUSES.has(job.status)) {
      await client.query("COMMIT");
      return job;
    }

    const attemptNo = Number(job.attempt_count || 0) + 1;
    const updated = (
      await client.query(
        `UPDATE jobs
         SET status = 'running',
             attempt_count = $2,
             lease_owner = $3,
             lease_until = now() + make_interval(secs => timeout_seconds),
             updated_at = now()
         WHERE id = $1
         RETURNING *`,
        [jobId, attemptNo, String(workerId || job.lease_owner || "worker")],
      )
    ).rows[0];
    await client.query(
      `INSERT INTO job_attempts (job_id, attempt_no, worker_id, status, heartbeat_at)
       VALUES ($1,$2,$3,'running',now())
       ON CONFLICT (job_id, attempt_no) DO UPDATE SET
         worker_id = excluded.worker_id,
         status = 'running',
         heartbeat_at = now()`,
      [jobId, attemptNo, String(workerId || job.lease_owner || "worker")],
    );
    await client.query("COMMIT");
    return updated;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {}
    throw error;
  } finally {
    client.release();
  }
}

async function heartbeatJob(pool, jobId, workerId, leaseSeconds = 300) {
  const result = await pool.query(
    `UPDATE jobs
     SET lease_until = now() + make_interval(secs => $3),
         updated_at = now()
     WHERE id = $1
       AND lease_owner = $2
       AND status IN ('leased', 'running')
     RETURNING *`,
    [jobId, String(workerId), normalizePositiveInteger(leaseSeconds, 300)],
  );
  await pool.query(
    `UPDATE job_attempts
     SET heartbeat_at = now()
     WHERE job_id = $1 AND worker_id = $2 AND status = 'running'`,
    [jobId, String(workerId)],
  );
  return result.rows[0] || null;
}

async function markJobSucceeded(pool, jobId, resultPayload = {}) {
  const result = await pool.query(
    `UPDATE jobs
     SET status = 'succeeded',
         result = $2::jsonb,
         lease_owner = NULL,
         lease_until = NULL,
         completed_at = now(),
         updated_at = now()
     WHERE id = $1
     RETURNING *`,
    [jobId, normalizeJson(resultPayload)],
  );
  await pool.query(
    `UPDATE job_attempts
     SET status = 'succeeded', finished_at = now()
     WHERE job_id = $1 AND status = 'running'`,
    [jobId],
  );
  return result.rows[0] || null;
}

async function markJobFailedOrRetry(pool, jobId, error, options = {}) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const job = (
      await client.query("SELECT * FROM jobs WHERE id = $1 FOR UPDATE", [jobId])
    ).rows[0];
    if (!job) return null;

    const attempts = Number(job.attempt_count || 0);
    const maxAttempts = Number(job.max_attempts || 1);
    const retry = options.retry !== false && attempts < maxAttempts;
    const status = retry ? "retry_waiting" : "failed";
    const delaySeconds = normalizePositiveInteger(
      options.retryDelaySeconds,
      Math.min(3600, 30 * Math.max(1, attempts)),
    );
    const message = String(error?.message || error || "job failed").slice(0, 2000);

    const updated = (
      await client.query(
        `UPDATE jobs
         SET status = $2,
             last_error = $3,
             lease_owner = NULL,
             lease_until = NULL,
             run_after = CASE WHEN $2 = 'retry_waiting'
               THEN now() + make_interval(secs => $4)
               ELSE run_after
             END,
             completed_at = CASE WHEN $2 = 'failed' THEN now() ELSE completed_at END,
             updated_at = now()
         WHERE id = $1
         RETURNING *`,
        [jobId, status, message, delaySeconds],
      )
    ).rows[0];

    await client.query(
      `UPDATE job_attempts
       SET status = $2, error = $3, finished_at = now()
       WHERE job_id = $1 AND status = 'running'`,
      [jobId, status, message],
    );
    await client.query("COMMIT");
    return updated;
  } catch (caught) {
    try {
      await client.query("ROLLBACK");
    } catch {}
    throw caught;
  } finally {
    client.release();
  }
}

async function cancelJob(pool, jobId, { accountId, reason } = {}) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const job = (
      await client.query("SELECT * FROM jobs WHERE id = $1 FOR UPDATE", [jobId])
    ).rows[0];
    if (!job) {
      await client.query("COMMIT");
      return null;
    }
    if (accountId && String(job.account_id) !== String(accountId)) {
      const error = new Error("job does not belong to account");
      error.statusCode = 403;
      error.code = "FORBIDDEN";
      throw error;
    }
    await lockAccountLane(client, job.account_id, "account-control");
    const updated = (
      await client.query(
        `UPDATE jobs
         SET status = 'cancelled',
             last_error = $2,
             lease_owner = NULL,
             lease_until = NULL,
             cancelled_at = now(),
             updated_at = now()
         WHERE id = $1
         RETURNING *`,
        [jobId, String(reason || "cancelled by user")],
      )
    ).rows[0];
    await client.query("COMMIT");
    return updated;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {}
    throw error;
  } finally {
    client.release();
  }
}

async function recoverExpiredLeases(pool) {
  const result = await pool.query(
    `UPDATE jobs
     SET status = CASE
           WHEN attempt_count >= max_attempts THEN 'failed'::job_status
           ELSE 'retry_waiting'::job_status
         END,
         last_error = COALESCE(last_error, 'lease expired'),
         lease_owner = NULL,
         lease_until = NULL,
         run_after = now(),
         updated_at = now()
     WHERE status IN ('leased', 'running')
       AND lease_until < now()
     RETURNING *`,
  );
  return result.rows;
}

module.exports = {
  cancelJob,
  createJob,
  getJob,
  heartbeatJob,
  leaseJobs,
  listJobs,
  markJobFailedOrRetry,
  markJobRunning,
  markJobSucceeded,
  recoverExpiredLeases,
};
