const { Pool } = require("pg");
const { MockStore } = require("./store");
const {
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
} = require("./jobs/postgres-jobs");
const {
  creditRechargeOrderOnce,
  syncRechargePaymentOrder,
} = require("./payments/canonical-ledger");
const {
  beginUpload,
  cleanupTemp,
  completeUpload,
  getSignedReadUrl,
  moveTempToPermanent,
} = require("./storage/object-storage-metadata");
const {
  checksum,
  ensurePostgresSchema,
  syncSnapshotProjections,
} = require("./postgres-schema");

const DEFAULT_DATABASE_URL = "postgres://root:root@127.0.0.1:5432/xiaolou";

function resolveSslConfig() {
  const mode = String(process.env.PGSSL_MODE || "").trim().toLowerCase();
  if (!mode || mode === "disable") return undefined;
  if (mode === "require") return { rejectUnauthorized: false };
  return undefined;
}

function serializeSnapshot(state) {
  return JSON.stringify(state);
}

function allowEmptyBootstrap() {
  return String(process.env.POSTGRES_ALLOW_EMPTY_BOOTSTRAP || "0").trim() === "1";
}

function envFlag(name) {
  return ["1", "true", "yes", "on"].includes(String(process.env[name] || "").trim().toLowerCase());
}

function isCompatReadOnlyMode() {
  return envFlag("CORE_API_COMPAT_READ_ONLY");
}

class PostgresStore extends MockStore {
  constructor(options = {}) {
    super();
    this.mode = "postgres";
    this.compatReadOnly = options.compatReadOnly ?? isCompatReadOnlyMode();
    this.connectionString = options.connectionString || process.env.DATABASE_URL || DEFAULT_DATABASE_URL;
    this.pool = options.pool || new Pool({
      connectionString: this.connectionString,
      max: Number(process.env.PGPOOL_MAX || 10),
      ssl: resolveSslConfig(),
    });
    this.snapshotKey = options.snapshotKey || "snapshot";
    this.lastWriteError = null;
    this._closed = false;
    this._closePromise = null;
    this._writeQueue = Promise.resolve();
  }

  static async create(options = {}) {
    const store = new PostgresStore(options);
    await store.initialize();
    return store;
  }

  async initialize() {
    const client = await this.pool.connect();
    try {
      await client.query("CREATE EXTENSION IF NOT EXISTS pgcrypto");
      await client.query("CREATE EXTENSION IF NOT EXISTS citext");
      await ensurePostgresSchema(client);
      const snapshot = await this.loadSnapshot(client);
      if (snapshot) {
        this.state = snapshot;
        if (this.normalizeState() && !this.compatReadOnly) {
          await this.saveSnapshot({ source: "startup-normalize" });
        }
      } else {
        if (this.compatReadOnly) {
          this.normalizeState();
          console.warn(
            "[postgres-store] CORE_API_COMPAT_READ_ONLY=1: no legacy snapshot found; using in-memory seed state and skipping PostgreSQL bootstrap/projection writes.",
          );
          return;
        }
        if (!allowEmptyBootstrap()) {
          throw new Error(
            "PostgreSQL snapshot is empty. Run npm run db:import-sqlite before starting core-api, or set POSTGRES_ALLOW_EMPTY_BOOTSTRAP=1 for a brand-new demo database.",
          );
        }
        await this.saveSnapshot({ source: "startup-seed" });
      }
    } finally {
      client.release();
    }
  }

  async loadSnapshot(clientOrPool = this.pool) {
    const result = await clientOrPool.query(
      `SELECT snapshot_value
       FROM legacy_state_snapshot
       WHERE snapshot_key = $1
       LIMIT 1`,
      [this.snapshotKey],
    );
    return result.rows[0]?.snapshot_value || null;
  }

  async persistSerializedSnapshot(serialized, source) {
    if (this.compatReadOnly) {
      throw new Error("Refusing to persist core-api legacy snapshot while CORE_API_COMPAT_READ_ONLY=1");
    }

    const snapshot = JSON.parse(serialized);
    if (snapshot?._snapshotError || snapshot?._snapshotTruncated) {
      throw new Error("Refusing to persist truncated or errored snapshot to PostgreSQL");
    }

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await ensurePostgresSchema(client);
      await client.query(
        `INSERT INTO legacy_state_snapshot
           (snapshot_key, snapshot_value, snapshot_checksum, imported_at, updated_at)
         VALUES ($1, $2::jsonb, $3, now(), now())
         ON CONFLICT (snapshot_key) DO UPDATE SET
           snapshot_value = excluded.snapshot_value,
           snapshot_checksum = excluded.snapshot_checksum,
           updated_at = excluded.updated_at`,
        [this.snapshotKey, serialized, checksum(snapshot)],
      );
      await syncSnapshotProjections(client, snapshot, { source, audit: false });
      await client.query("COMMIT");
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {}
      throw error;
    } finally {
      client.release();
    }
  }

  saveSnapshot(options = {}) {
    if (this.compatReadOnly) return Promise.resolve();
    if (!this._writeQueue) return Promise.resolve();
    if (this._closed) return this._writeQueue;
    let serialized;
    try {
      serialized = serializeSnapshot(this.state);
    } catch (error) {
      this.lastWriteError = error;
      console.error("[postgres-store] snapshot serialize failed:", error?.message || error);
      return Promise.reject(error);
    }

    const source = options.source || "runtime";
    const writeJob = this._writeQueue
      .then(() => this.persistSerializedSnapshot(serialized, source))
      .then(() => {
        this.lastWriteError = null;
      });
    this._writeQueue = writeJob.catch((error) => {
      this.lastWriteError = error;
      console.error("[postgres-store] snapshot write failed:", error?.message || error);
    });
    return writeJob;
  }

  queueSnapshotSave(source = "runtime") {
    if (this.compatReadOnly) return;
    if (!this._writeQueue) return;
    this.saveSnapshot({ source }).catch(() => {});
  }

  async flushSnapshot() {
    if (this.compatReadOnly) return;
    await this._writeQueue;
    if (this.lastWriteError) {
      throw this.lastWriteError;
    }
  }

  async close() {
    if (this._closePromise) return this._closePromise;
    this._closed = true;
    this._closePromise = (async () => {
      try {
        await this.flushSnapshot();
      } finally {
        await this.pool.end();
      }
    })();
    return this._closePromise;
  }

  createCanonicalJob(input) {
    return createJob(this.pool, input);
  }

  getCanonicalJob(jobId) {
    return getJob(this.pool, jobId);
  }

  listCanonicalJobs(filters) {
    return listJobs(this.pool, filters);
  }

  leaseCanonicalJobs(input) {
    return leaseJobs(this.pool, input);
  }

  markCanonicalJobRunning(jobId, workerId) {
    return markJobRunning(this.pool, jobId, workerId);
  }

  heartbeatCanonicalJob(jobId, workerId, leaseSeconds) {
    return heartbeatJob(this.pool, jobId, workerId, leaseSeconds);
  }

  markCanonicalJobSucceeded(jobId, resultPayload) {
    return markJobSucceeded(this.pool, jobId, resultPayload);
  }

  markCanonicalJobFailedOrRetry(jobId, error, options) {
    return markJobFailedOrRetry(this.pool, jobId, error, options);
  }

  cancelCanonicalJob(jobId, input) {
    return cancelJob(this.pool, jobId, input);
  }

  recoverExpiredCanonicalJobLeases() {
    return recoverExpiredLeases(this.pool);
  }

  syncCanonicalRechargeOrder(order, providerOverride) {
    return syncRechargePaymentOrder(this.pool, order, providerOverride);
  }

  recordCanonicalRechargePayment(input) {
    return creditRechargeOrderOnce(this.pool, input);
  }

  beginObjectUpload(input) {
    return beginUpload(this.pool, input);
  }

  completeObjectUpload(input) {
    return completeUpload(this.pool, input);
  }

  getObjectSignedReadUrl(input) {
    return getSignedReadUrl(this.pool, input);
  }

  moveObjectTempToPermanent(input) {
    return moveTempToPermanent(this.pool, input);
  }

  cleanupTemporaryObjects(input) {
    return cleanupTemp(this.pool, input);
  }
}

function shouldSaveAlways() {
  return true;
}

function shouldSaveTruthy(result) {
  return Boolean(result);
}

function shouldSaveReaped(result) {
  return Number(result?.reaped || 0) > 0;
}

function shouldSaveNonEmptyArray(result) {
  return Array.isArray(result) && result.length > 0;
}

const MUTATING_METHODS = [
  ["reset", shouldSaveAlways],
  ["createProject", shouldSaveAlways],
  ["updateSettings", shouldSaveTruthy],
  ["updateProject", shouldSaveTruthy],
  ["updateScript", shouldSaveTruthy],
  ["createAsset", shouldSaveTruthy],
  ["saveProjectAsset", shouldSaveTruthy],
  ["updateAsset", shouldSaveTruthy],
  ["deleteAsset", shouldSaveTruthy],
  ["updateStoryboard", shouldSaveTruthy],
  ["deleteStoryboard", shouldSaveTruthy],
  ["updateDubbing", shouldSaveTruthy],
  ["updateTimeline", shouldSaveTruthy],
  ["createWalletRechargeOrder", shouldSaveTruthy],
  ["getWalletRechargeOrder", shouldSaveTruthy],
  ["updateWalletRechargeOrder", shouldSaveTruthy],
  ["markWalletRechargeOrderPaid", shouldSaveTruthy],
  ["submitWalletRechargeTransferProof", shouldSaveTruthy],
  ["reviewWalletRechargeOrder", shouldSaveTruthy],
  ["confirmWalletRechargeOrder", shouldSaveTruthy],
  ["saveApiCenterVendorApiKey", shouldSaveTruthy],
  ["testApiCenterVendorConnection", shouldSaveTruthy],
  ["updateApiVendorModel", shouldSaveTruthy],
  ["updateApiCenterDefaults", shouldSaveTruthy],
  ["createEnterpriseApplication", shouldSaveAlways],
  ["registerPersonalUser", shouldSaveAlways],
  ["registerEnterpriseAdmin", shouldSaveAlways],
  ["loginWithGoogle", shouldSaveAlways],
  ["updateMe", shouldSaveTruthy],
  ["createOrganizationMember", shouldSaveAlways],
  ["createTask", shouldSaveAlways],
  ["updateTask", shouldSaveTruthy],
  ["deleteTask", shouldSaveTruthy],
  ["clearTasks", (result) => Number(result?.removedCount || 0) > 0],
  ["reconcileStaleCreateTasks", shouldSaveReaped],
  ["deleteCreateImage", shouldSaveTruthy],
  ["deleteCreateVideo", shouldSaveTruthy],
  ["saveCanvasProject", shouldSaveAlways],
  ["deleteCanvasProject", shouldSaveTruthy],
  ["saveAgentCanvasProject", shouldSaveAlways],
  ["deleteAgentCanvasProject", shouldSaveTruthy],
  ["createPlaygroundConversation", shouldSaveTruthy],
  ["updatePlaygroundConversation", shouldSaveTruthy],
  ["deletePlaygroundConversation", shouldSaveTruthy],
  ["appendPlaygroundMessage", shouldSaveTruthy],
  ["replacePlaygroundMessage", shouldSaveTruthy],
  ["createPlaygroundChatJob", shouldSaveTruthy],
  ["updatePlaygroundChatJob", shouldSaveTruthy],
  ["reconcileStalePlaygroundChatJobs", shouldSaveReaped],
  ["setPlaygroundMemoryPreference", shouldSaveTruthy],
  ["upsertPlaygroundMemories", shouldSaveNonEmptyArray],
  ["updatePlaygroundMemory", shouldSaveTruthy],
  ["deletePlaygroundMemory", shouldSaveTruthy],
];

for (const [methodName, predicate] of MUTATING_METHODS) {
  const original = MockStore.prototype[methodName];
  if (typeof original !== "function") continue;

  PostgresStore.prototype[methodName] = function wrappedPostgresMutation(...args) {
    const result = original.apply(this, args);
    if (result && typeof result.then === "function") {
      return result.then((value) => {
        if (predicate(value)) this.queueSnapshotSave(methodName);
        return value;
      });
    }
    if (predicate(result)) this.queueSnapshotSave(methodName);
    return result;
  };
}

module.exports = {
  DEFAULT_DATABASE_URL,
  isCompatReadOnlyMode,
  PostgresStore,
};
