const { mkdirSync } = require("node:fs");
const { dirname, resolve } = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { MockStore } = require("./store");

class SqliteStore extends MockStore {
  constructor(options = {}) {
    super();
    this.mode = "sqlite";
    this.dbPath = resolve(
      options.dbPath || process.env.CORE_API_DB_PATH || "D:/xuan/小楼WEB/core-api/data/demo.sqlite"
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
    const statement = this.db.prepare(
      "SELECT state_value FROM app_state WHERE state_key = 'snapshot' LIMIT 1"
    );
    const row = statement.get();
    if (!row?.state_value) {
      return null;
    }

    return JSON.parse(row.state_value);
  }

  saveSnapshot() {
    if (!this.db) {
      return;
    }

    const statement = this.db.prepare(`
      INSERT INTO app_state (state_key, state_value, updated_at)
      VALUES ('snapshot', ?, ?)
      ON CONFLICT(state_key) DO UPDATE SET
        state_value = excluded.state_value,
        updated_at = excluded.updated_at
    `);

    statement.run(JSON.stringify(this.state), new Date().toISOString());
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
