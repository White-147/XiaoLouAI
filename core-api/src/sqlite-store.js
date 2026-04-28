const { mkdirSync } = require("node:fs");
const { dirname, resolve } = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { MockStore } = require("./store");

// Maximum byte length of a single string value before it gets truncated in
// the snapshot. Prevents RangeError: Invalid string length when canvas
// workflows or asset records contain embedded base64 images.
const SNAPSHOT_MAX_STRING_BYTES = 200_000; // 200 KB per string
const SNAPSHOT_MAX_TOTAL_BYTES = 8_000_000; // 8 MB total

function safeSnapshotSerialize(state) {
  // First pass: truncate oversized strings.
  let json;
  try {
    json = JSON.stringify(state, (_key, val) => {
      if (typeof val === "string" && val.length > SNAPSHOT_MAX_STRING_BYTES) {
        return `[truncated:${val.length}chars]`;
      }
      return val;
    });
  } catch (err) {
    // Circular reference or other serialization error — return a sentinel.
    console.error("[sqlite-store] JSON.stringify error (returning sentinel):", err.message);
    return JSON.stringify({ _snapshotError: err.message, _ts: Date.now() });
  }

  // Second pass: if still too large, return a minimal sentinel.
  if (json.length > SNAPSHOT_MAX_TOTAL_BYTES) {
    console.warn(
      `[sqlite-store] snapshot too large (${json.length} bytes) — storing sentinel instead`
    );
    return JSON.stringify({ _snapshotTruncated: true, _size: json.length, _ts: Date.now() });
  }

  return json;
}

class SqliteStore extends MockStore {
  constructor(options = {}) {
    super();
    this.mode = "sqlite";
    // Portable default: repo-relative path under core-api/data/. The old
    // hardcoded D:/xuan/… fallback broke everywhere that wasn't the
    // original author's machine. Override with CORE_API_DB_PATH (or
    // options.dbPath) when you need a custom location.
    this.dbPath = resolve(
      options.dbPath ||
        process.env.CORE_API_DB_PATH ||
        resolve(__dirname, "..", "data", "demo.sqlite"),
    );

    mkdirSync(dirname(this.dbPath), { recursive: true });
    this.db = new DatabaseSync(this.dbPath);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS app_state (
        state_key TEXT PRIMARY KEY,
        state_value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);

    const snapshot = this.loadSnapshot();
    if (snapshot) {
      this.state = snapshot;
      if (this.normalizeState()) {
        this.saveSnapshot();
      }
    } else {
      this.saveSnapshot();
    }
  }

  loadSnapshot() {
    try {
      const statement = this.db.prepare(
        "SELECT state_value FROM app_state WHERE state_key = 'snapshot' LIMIT 1"
      );
      const row = statement.get();
      if (!row?.state_value) return null;

      const parsed = JSON.parse(row.state_value);
      // Discard sentinel records written during previous truncation.
      if (parsed?._snapshotError || parsed?._snapshotTruncated) {
        console.warn("[sqlite-store] discarding truncated/errored snapshot, starting fresh");
        return null;
      }
      return parsed;
    } catch (err) {
      console.error("[sqlite-store] loadSnapshot failed (starting fresh):", err.message);
      return null;
    }
  }

  saveSnapshot() {
    if (!this.db) return;

    let serialized;
    try {
      serialized = safeSnapshotSerialize(this.state);
    } catch (err) {
      console.error("[sqlite-store] snapshot serialize failed (non-fatal):", err.message);
      return;
    }

    try {
      const statement = this.db.prepare(`
        INSERT INTO app_state (state_key, state_value, updated_at)
        VALUES ('snapshot', ?, ?)
        ON CONFLICT(state_key) DO UPDATE SET
          state_value = excluded.state_value,
          updated_at = excluded.updated_at
      `);
      statement.run(serialized, new Date().toISOString());
    } catch (err) {
      console.error("[sqlite-store] snapshot write failed (non-fatal):", err.message);
      // Never propagate — a failed snapshot write must not crash the server.
    }
  }

  reset() {
    super.reset();
    if (this.db) {
      this.saveSnapshot();
    }
  }

  createProject(input, actorId) {
    const result = super.createProject(input, actorId);
    this.saveSnapshot();
    return result;
  }

  updateSettings(projectId, input) {
    const result = super.updateSettings(projectId, input);
    if (result) this.saveSnapshot();
    return result;
  }

  updateProject(projectId, input) {
    const result = super.updateProject(projectId, input);
    if (result) this.saveSnapshot();
    return result;
  }

  updateScript(projectId, content) {
    const result = super.updateScript(projectId, content);
    if (result) this.saveSnapshot();
    return result;
  }

  createAsset(projectId, input) {
    const result = super.createAsset(projectId, input);
    if (result) this.saveSnapshot();
    return result;
  }

  saveProjectAsset(projectId, input) {
    const result = super.saveProjectAsset(projectId, input);
    if (result) this.saveSnapshot();
    return result;
  }

  updateAsset(projectId, assetId, input) {
    const result = super.updateAsset(projectId, assetId, input);
    if (result) this.saveSnapshot();
    return result;
  }

  deleteAsset(projectId, assetId) {
    const result = super.deleteAsset(projectId, assetId);
    if (result) this.saveSnapshot();
    return result;
  }

  updateStoryboard(projectId, storyboardId, input) {
    const result = super.updateStoryboard(projectId, storyboardId, input);
    if (result) this.saveSnapshot();
    return result;
  }

  deleteStoryboard(projectId, storyboardId) {
    const result = super.deleteStoryboard(projectId, storyboardId);
    if (result) this.saveSnapshot();
    return result;
  }

  updateDubbing(projectId, dubbingId, input) {
    const result = super.updateDubbing(projectId, dubbingId, input);
    if (result) this.saveSnapshot();
    return result;
  }

  updateTimeline(projectId, input) {
    const result = super.updateTimeline(projectId, input);
    if (result) this.saveSnapshot();
    return result;
  }

  createWalletRechargeOrder(input, actorId) {
    const result = super.createWalletRechargeOrder(input, actorId);
    if (result) this.saveSnapshot();
    return result;
  }

  getWalletRechargeOrder(orderId, actorId) {
    const result = super.getWalletRechargeOrder(orderId, actorId);
    if (result) this.saveSnapshot();
    return result;
  }

  updateWalletRechargeOrder(orderId, patch, actorId, options) {
    const result = super.updateWalletRechargeOrder(orderId, patch, actorId, options);
    if (result) this.saveSnapshot();
    return result;
  }

  markWalletRechargeOrderPaid(orderId, actorId, patch) {
    const result = super.markWalletRechargeOrderPaid(orderId, actorId, patch);
    if (result) this.saveSnapshot();
    return result;
  }

  submitWalletRechargeTransferProof(orderId, input, actorId) {
    const result = super.submitWalletRechargeTransferProof(orderId, input, actorId);
    if (result) this.saveSnapshot();
    return result;
  }

  reviewWalletRechargeOrder(orderId, input, actorId) {
    const result = super.reviewWalletRechargeOrder(orderId, input, actorId);
    if (result) this.saveSnapshot();
    return result;
  }

  confirmWalletRechargeOrder(orderId, actorId) {
    const result = super.confirmWalletRechargeOrder(orderId, actorId);
    if (result) this.saveSnapshot();
    return result;
  }

  saveApiCenterVendorApiKey(vendorId, apiKey, actorId) {
    const result = super.saveApiCenterVendorApiKey(vendorId, apiKey, actorId);
    if (result) this.saveSnapshot();
    return result;
  }

  async testApiCenterVendorConnection(vendorId, actorId) {
    const result = await super.testApiCenterVendorConnection(vendorId, actorId);
    if (result) this.saveSnapshot();
    return result;
  }

  updateApiVendorModel(vendorId, modelId, patch, actorId) {
    const result = super.updateApiVendorModel(vendorId, modelId, patch, actorId);
    if (result) this.saveSnapshot();
    return result;
  }

  updateApiCenterDefaults(input, actorId) {
    const result = super.updateApiCenterDefaults(input, actorId);
    if (result) this.saveSnapshot();
    return result;
  }

  createEnterpriseApplication(input) {
    const result = super.createEnterpriseApplication(input);
    this.saveSnapshot();
    return result;
  }

  registerPersonalUser(input) {
    const result = super.registerPersonalUser(input);
    this.saveSnapshot();
    return result;
  }

  registerEnterpriseAdmin(input) {
    const result = super.registerEnterpriseAdmin(input);
    this.saveSnapshot();
    return result;
  }

  loginWithGoogle(profile) {
    const result = super.loginWithGoogle(profile);
    this.saveSnapshot();
    return result;
  }

  createOrganizationMember(organizationId, input, actorId) {
    const result = super.createOrganizationMember(organizationId, input, actorId);
    this.saveSnapshot();
    return result;
  }

  createTask(params) {
    const result = super.createTask(params);
    this.saveSnapshot();
    return result;
  }

  updateTask(taskId, patch) {
    const result = super.updateTask(taskId, patch);
    if (result) this.saveSnapshot();
    return result;
  }

  reconcileStaleCreateTasks(staleAfterMs) {
    const result = super.reconcileStaleCreateTasks(staleAfterMs);
    if (result?.reaped > 0) this.saveSnapshot();
    return result;
  }

  deleteCreateImage(id, actorId) {
    const result = super.deleteCreateImage(id, actorId);
    if (result) this.saveSnapshot();
    return result;
  }

  deleteCreateVideo(id, actorId) {
    const result = super.deleteCreateVideo(id, actorId);
    if (result) this.saveSnapshot();
    return result;
  }

  saveCanvasProject(actorId, input) {
    const result = super.saveCanvasProject(actorId, input);
    this.saveSnapshot();
    return result;
  }

  deleteCanvasProject(actorId, projectId) {
    const result = super.deleteCanvasProject(actorId, projectId);
    if (result) this.saveSnapshot();
    return result;
  }

  createPlaygroundConversation(actorId, input) {
    const result = super.createPlaygroundConversation(actorId, input);
    if (result) this.saveSnapshot();
    return result;
  }

  updatePlaygroundConversation(actorId, conversationId, input) {
    const result = super.updatePlaygroundConversation(actorId, conversationId, input);
    if (result) this.saveSnapshot();
    return result;
  }

  deletePlaygroundConversation(actorId, conversationId) {
    const result = super.deletePlaygroundConversation(actorId, conversationId);
    if (result) this.saveSnapshot();
    return result;
  }

  appendPlaygroundMessage(actorId, conversationId, input) {
    const result = super.appendPlaygroundMessage(actorId, conversationId, input);
    if (result) this.saveSnapshot();
    return result;
  }

  replacePlaygroundMessage(actorId, conversationId, messageId, patch) {
    const result = super.replacePlaygroundMessage(actorId, conversationId, messageId, patch);
    if (result) this.saveSnapshot();
    return result;
  }

  createPlaygroundChatJob(actorId, input) {
    const result = super.createPlaygroundChatJob(actorId, input);
    if (result) this.saveSnapshot();
    return result;
  }

  updatePlaygroundChatJob(actorId, jobId, patch) {
    const result = super.updatePlaygroundChatJob(actorId, jobId, patch);
    if (result) this.saveSnapshot();
    return result;
  }

  reconcileStalePlaygroundChatJobs(staleAfterMs) {
    const result = super.reconcileStalePlaygroundChatJobs(staleAfterMs);
    if (result?.reaped > 0) this.saveSnapshot();
    return result;
  }

  setPlaygroundMemoryPreference(actorId, input) {
    const result = super.setPlaygroundMemoryPreference(actorId, input);
    if (result) this.saveSnapshot();
    return result;
  }

  upsertPlaygroundMemories(actorId, entries, source) {
    const result = super.upsertPlaygroundMemories(actorId, entries, source);
    if (Array.isArray(result) && result.length) this.saveSnapshot();
    return result;
  }

  updatePlaygroundMemory(actorId, key, input) {
    const result = super.updatePlaygroundMemory(actorId, key, input);
    if (result) this.saveSnapshot();
    return result;
  }

  deletePlaygroundMemory(actorId, key) {
    const result = super.deletePlaygroundMemory(actorId, key);
    if (result) this.saveSnapshot();
    return result;
  }

  close() {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}

module.exports = {
  SqliteStore,
};
