const { createHash } = require("node:crypto");
const { ensureWindowsNativeSchema } = require("./windows-native-schema");

const CORE_TABLES = [
  "pricing_rules",
  "enterprise_applications",
  "create_studio_videos",
  "create_studio_images",
  "agent_canvas_projects",
  "playground_chat_jobs",
  "playground_memory_preferences",
  "playground_memories",
  "playground_messages",
  "playground_conversations",
  "canvas_projects",
  "api_center_models",
  "api_center_vendors",
  "tasks",
  "project_timelines",
  "dubbings",
  "videos",
  "storyboards",
  "project_assets",
  "project_scripts",
  "project_settings",
  "projects",
  "wallet_recharge_orders",
  "wallet_ledger",
  "wallets",
  "organization_members",
  "organizations",
  "users",
];

const CREATE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS legacy_state_snapshot (
  snapshot_key text PRIMARY KEY,
  snapshot_value jsonb NOT NULL,
  snapshot_checksum text NOT NULL,
  imported_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS migration_audit (
  id bigserial PRIMARY KEY,
  source text NOT NULL,
  entity text NOT NULL,
  source_count integer NOT NULL DEFAULT 0,
  target_count integer NOT NULL DEFAULT 0,
  checksum text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id text PRIMARY KEY,
  email text,
  display_name text,
  platform_role text,
  organization_id text,
  data jsonb NOT NULL,
  created_at text,
  updated_at text
);

CREATE TABLE IF NOT EXISTS organizations (
  id text PRIMARY KEY,
  name text,
  data jsonb NOT NULL,
  created_at text,
  updated_at text
);

CREATE TABLE IF NOT EXISTS organization_members (
  id text PRIMARY KEY,
  organization_id text,
  user_id text,
  role text,
  data jsonb NOT NULL,
  created_at text,
  updated_at text
);

CREATE TABLE IF NOT EXISTS wallets (
  id text PRIMARY KEY,
  owner_type text,
  owner_id text,
  balance numeric,
  available_credits numeric,
  frozen_credits numeric,
  data jsonb NOT NULL,
  created_at text,
  updated_at text
);

CREATE TABLE IF NOT EXISTS wallet_ledger (
  id text PRIMARY KEY,
  wallet_id text,
  actor_id text,
  entry_type text,
  amount numeric,
  source_type text,
  source_id text,
  data jsonb NOT NULL,
  created_at text,
  updated_at text
);

CREATE TABLE IF NOT EXISTS wallet_recharge_orders (
  id text PRIMARY KEY,
  actor_id text,
  wallet_id text,
  payment_method text,
  mode text,
  status text,
  amount numeric,
  credits numeric,
  provider_trade_no text,
  data jsonb NOT NULL,
  created_at text,
  updated_at text
);

CREATE TABLE IF NOT EXISTS projects (
  id text PRIMARY KEY,
  owner_type text,
  owner_id text,
  title text,
  status text,
  organization_id text,
  data jsonb NOT NULL,
  created_at text,
  updated_at text
);

CREATE TABLE IF NOT EXISTS tasks (
  id text PRIMARY KEY,
  project_id text,
  actor_id text,
  type text,
  action_code text,
  status text,
  wallet_id text,
  data jsonb NOT NULL,
  created_at text,
  updated_at text
);

CREATE TABLE IF NOT EXISTS video_replace_jobs (
  job_id uuid PRIMARY KEY,
  legacy_id text,
  stage text NOT NULL,
  progress numeric NOT NULL DEFAULT 0,
  message text,
  error text,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at text NOT NULL,
  updated_at text NOT NULL
);

CREATE TABLE IF NOT EXISTS jaaz_canvases (
  id text PRIMARY KEY,
  name text NOT NULL,
  data text,
  description text NOT NULL DEFAULT '',
  thumbnail text,
  created_at text NOT NULL,
  updated_at text NOT NULL
);

CREATE TABLE IF NOT EXISTS jaaz_chat_sessions (
  id text PRIMARY KEY,
  canvas_id text,
  title text,
  model text,
  provider text,
  created_at text NOT NULL,
  updated_at text NOT NULL
);

CREATE TABLE IF NOT EXISTS jaaz_chat_messages (
  id bigserial PRIMARY KEY,
  session_id text NOT NULL,
  role text NOT NULL,
  message text,
  created_at text NOT NULL,
  updated_at text NOT NULL
);

CREATE TABLE IF NOT EXISTS jaaz_comfy_workflows (
  id bigserial PRIMARY KEY,
  name text NOT NULL,
  api_json text,
  description text NOT NULL DEFAULT '',
  inputs text,
  outputs text,
  created_at text NOT NULL,
  updated_at text NOT NULL
);

CREATE TABLE IF NOT EXISTS project_settings (
  project_id text PRIMARY KEY,
  data jsonb NOT NULL,
  updated_at text
);

CREATE TABLE IF NOT EXISTS project_scripts (
  id text PRIMARY KEY,
  project_id text,
  title text,
  version integer,
  data jsonb NOT NULL,
  created_at text,
  updated_at text
);

CREATE TABLE IF NOT EXISTS project_assets (
  id text PRIMARY KEY,
  project_id text,
  asset_type text,
  name text,
  scope text,
  data jsonb NOT NULL,
  created_at text,
  updated_at text
);

CREATE TABLE IF NOT EXISTS storyboards (
  id text PRIMARY KEY,
  project_id text,
  shot_no integer,
  title text,
  image_status text,
  video_status text,
  data jsonb NOT NULL,
  created_at text,
  updated_at text
);

CREATE TABLE IF NOT EXISTS videos (
  id text PRIMARY KEY,
  project_id text,
  storyboard_id text,
  status text,
  video_url text,
  data jsonb NOT NULL,
  created_at text,
  updated_at text
);

CREATE TABLE IF NOT EXISTS dubbings (
  id text PRIMARY KEY,
  project_id text,
  storyboard_id text,
  status text,
  audio_url text,
  data jsonb NOT NULL,
  created_at text,
  updated_at text
);

CREATE TABLE IF NOT EXISTS project_timelines (
  project_id text PRIMARY KEY,
  version integer,
  data jsonb NOT NULL,
  updated_at text
);

CREATE TABLE IF NOT EXISTS canvas_projects (
  id text PRIMARY KEY,
  actor_id text,
  title text,
  data jsonb NOT NULL,
  created_at text,
  updated_at text
);

CREATE TABLE IF NOT EXISTS agent_canvas_projects (
  id text PRIMARY KEY,
  actor_id text,
  title text,
  data jsonb NOT NULL,
  created_at text,
  updated_at text
);

CREATE TABLE IF NOT EXISTS playground_conversations (
  id text PRIMARY KEY,
  actor_id text,
  title text,
  model text,
  data jsonb NOT NULL,
  created_at text,
  updated_at text
);

CREATE TABLE IF NOT EXISTS playground_messages (
  id text PRIMARY KEY,
  conversation_id text,
  actor_id text,
  role text,
  status text,
  data jsonb NOT NULL,
  created_at text,
  updated_at text
);

CREATE TABLE IF NOT EXISTS playground_memories (
  id text PRIMARY KEY,
  actor_id text,
  memory_key text,
  memory_value text,
  data jsonb NOT NULL,
  created_at text,
  updated_at text
);

CREATE TABLE IF NOT EXISTS playground_memory_preferences (
  actor_id text PRIMARY KEY,
  enabled boolean,
  data jsonb NOT NULL,
  updated_at text
);

CREATE TABLE IF NOT EXISTS playground_chat_jobs (
  id text PRIMARY KEY,
  actor_id text,
  conversation_id text,
  status text,
  data jsonb NOT NULL,
  created_at text,
  updated_at text
);

CREATE TABLE IF NOT EXISTS api_center_vendors (
  id text PRIMARY KEY,
  name text,
  connected boolean,
  data jsonb NOT NULL,
  updated_at text
);

CREATE TABLE IF NOT EXISTS api_center_models (
  id text PRIMARY KEY,
  vendor_id text,
  name text,
  domain text,
  enabled boolean,
  data jsonb NOT NULL,
  updated_at text
);

CREATE TABLE IF NOT EXISTS create_studio_images (
  id text PRIMARY KEY,
  actor_id text,
  task_id text,
  model text,
  prompt text,
  image_url text,
  data jsonb NOT NULL,
  created_at text,
  updated_at text
);

CREATE TABLE IF NOT EXISTS create_studio_videos (
  id text PRIMARY KEY,
  actor_id text,
  task_id text,
  model text,
  prompt text,
  video_url text,
  data jsonb NOT NULL,
  created_at text,
  updated_at text
);

CREATE TABLE IF NOT EXISTS enterprise_applications (
  id text PRIMARY KEY,
  company_name text,
  contact_name text,
  phone text,
  email text,
  status text,
  data jsonb NOT NULL,
  created_at text,
  updated_at text
);

CREATE TABLE IF NOT EXISTS pricing_rules (
  action_code text PRIMARY KEY,
  credits numeric,
  data jsonb NOT NULL,
  updated_at text
);

CREATE INDEX IF NOT EXISTS idx_projects_owner ON projects(owner_type, owner_id);
CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_tasks_actor ON tasks(actor_id);
CREATE INDEX IF NOT EXISTS idx_video_replace_jobs_stage ON video_replace_jobs(stage);
CREATE INDEX IF NOT EXISTS idx_video_replace_jobs_updated ON video_replace_jobs(updated_at);
CREATE INDEX IF NOT EXISTS idx_video_replace_jobs_legacy_id ON video_replace_jobs(legacy_id);
CREATE INDEX IF NOT EXISTS idx_jaaz_chat_sessions_canvas ON jaaz_chat_sessions(canvas_id);
CREATE INDEX IF NOT EXISTS idx_jaaz_chat_messages_session_id ON jaaz_chat_messages(session_id, id);
CREATE INDEX IF NOT EXISTS idx_jaaz_canvases_updated ON jaaz_canvases(updated_at);
CREATE INDEX IF NOT EXISTS idx_project_assets_project ON project_assets(project_id);
CREATE INDEX IF NOT EXISTS idx_storyboards_project ON storyboards(project_id);
CREATE INDEX IF NOT EXISTS idx_videos_project ON videos(project_id);
CREATE INDEX IF NOT EXISTS idx_dubbings_project ON dubbings(project_id);
CREATE INDEX IF NOT EXISTS idx_wallets_owner ON wallets(owner_type, owner_id);
CREATE INDEX IF NOT EXISTS idx_wallet_ledger_wallet ON wallet_ledger(wallet_id);
CREATE INDEX IF NOT EXISTS idx_wallet_recharge_wallet ON wallet_recharge_orders(wallet_id);
CREATE INDEX IF NOT EXISTS idx_canvas_actor ON canvas_projects(actor_id);
CREATE INDEX IF NOT EXISTS idx_agent_canvas_actor ON agent_canvas_projects(actor_id);
CREATE INDEX IF NOT EXISTS idx_playground_conversation_actor ON playground_conversations(actor_id);
CREATE INDEX IF NOT EXISTS idx_playground_message_conversation ON playground_messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_create_studio_images_actor ON create_studio_images(actor_id);
CREATE INDEX IF NOT EXISTS idx_create_studio_images_task ON create_studio_images(task_id);
CREATE INDEX IF NOT EXISTS idx_create_studio_videos_actor ON create_studio_videos(actor_id);
CREATE INDEX IF NOT EXISTS idx_create_studio_videos_task ON create_studio_videos(task_id);
CREATE INDEX IF NOT EXISTS idx_enterprise_applications_status ON enterprise_applications(status);
`;

const COMPAT_READONLY_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS legacy_state_snapshot (
  snapshot_key text PRIMARY KEY,
  snapshot_value jsonb NOT NULL,
  snapshot_checksum text NOT NULL,
  imported_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS migration_audit (
  id bigserial PRIMARY KEY,
  source text NOT NULL,
  entity text NOT NULL,
  source_count integer NOT NULL DEFAULT 0,
  target_count integer NOT NULL DEFAULT 0,
  checksum text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS video_replace_jobs (
  job_id uuid PRIMARY KEY,
  legacy_id text,
  stage text NOT NULL,
  progress numeric NOT NULL DEFAULT 0,
  message text,
  error text,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at text NOT NULL,
  updated_at text NOT NULL
);

ALTER TABLE video_replace_jobs ADD COLUMN IF NOT EXISTS legacy_id text;
CREATE INDEX IF NOT EXISTS idx_video_replace_jobs_stage ON video_replace_jobs(stage);
CREATE INDEX IF NOT EXISTS idx_video_replace_jobs_updated ON video_replace_jobs(updated_at);
CREATE INDEX IF NOT EXISTS idx_video_replace_jobs_legacy_id ON video_replace_jobs(legacy_id);
`;

const LEGACY_PROJECTION_SCHEMA = {
  users: {
    id: "text",
    email: "text",
    display_name: "text",
    platform_role: "text",
    organization_id: "text",
    data: "jsonb",
  },
  organizations: {
    id: "text",
    name: "text",
    data: "jsonb",
  },
  wallets: {
    id: "text",
    owner_type: "text",
    owner_id: "text",
    data: "jsonb",
  },
  wallet_ledger: {
    id: "text",
    wallet_id: "text",
    actor_id: "text",
    data: "jsonb",
  },
};

function stableStringify(value) {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
    .join(",")}}`;
}

function checksum(value) {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function text(value) {
  if (value === undefined || value === null) return null;
  const normalized = String(value).trim();
  return normalized || null;
}

function numberOrNull(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function envFlag(name) {
  return ["1", "true", "yes", "on"].includes(String(process.env[name] || "").trim().toLowerCase());
}

function rowId(prefix, parts) {
  const raw = parts.map((part) => text(part) || "unknown").join(":");
  return `${prefix}_${createHash("sha1").update(raw).digest("hex").slice(0, 24)}`;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

function ownerUuid(ownerType, ownerId) {
  const normalizedOwnerType = String(ownerType || "").trim().toLowerCase();
  const entity = ["organization", "org", "enterprise"].includes(normalizedOwnerType)
    ? "organization"
    : "user";
  return legacyUuid(entity, ownerId);
}

function flattenMapOfArrays(mapValue, mapper) {
  const rows = [];
  for (const [ownerId, items] of Object.entries(asObject(mapValue))) {
    for (const item of asArray(items)) {
      rows.push(mapper(ownerId, asObject(item)));
    }
  }
  return rows;
}

function mapObjectValues(mapValue, mapper) {
  return Object.entries(asObject(mapValue)).map(([key, item]) => mapper(key, asObject(item)));
}

function projectSnapshot(snapshot) {
  const state = asObject(snapshot);
  const apiCenterConfig = asObject(state.apiCenterConfig);
  const vendors = asArray(apiCenterConfig.vendors);
  const apiModels = [];
  for (const vendor of vendors) {
    for (const model of asArray(vendor.models)) {
      apiModels.push({
        ...model,
        vendorId: vendor.id,
      });
    }
  }

  const wallets = asArray(state.wallets).length
    ? asArray(state.wallets)
    : state.wallet
      ? [{ id: "wallet_legacy_default", ownerType: "user", ownerId: state.wallet.ownerId, ...state.wallet }]
      : [];

  return {
    users: asArray(state.users).map((item) => asObject(item)),
    organizations: asArray(state.organizations).map((item) => asObject(item)),
    organization_members: asArray(state.organizationMemberships).map((item) => asObject(item)),
    wallets: wallets.map((item) => asObject(item)),
    wallet_ledger: asArray(state.walletLedgerEntries).map((item) => asObject(item)),
    wallet_recharge_orders: asArray(state.walletRechargeOrders).map((item) => asObject(item)),
    projects: asArray(state.projects).map((item) => asObject(item)),
    tasks: asArray(state.tasks).map((item) => asObject(item)),
    project_settings: mapObjectValues(state.settingsByProjectId, (projectId, item) => ({
      ...item,
      projectId,
    })),
    project_scripts: mapObjectValues(state.scriptsByProjectId, (projectId, item) => ({
      ...item,
      projectId: item.projectId || projectId,
    })),
    project_assets: flattenMapOfArrays(state.assetsByProjectId, (projectId, item) => ({
      ...item,
      projectId: item.projectId || projectId,
    })),
    storyboards: flattenMapOfArrays(state.storyboardsByProjectId, (projectId, item) => ({
      ...item,
      projectId: item.projectId || projectId,
    })),
    videos: flattenMapOfArrays(state.videosByProjectId, (projectId, item) => ({
      ...item,
      projectId: item.projectId || projectId,
    })),
    dubbings: flattenMapOfArrays(state.dubbingsByProjectId, (projectId, item) => ({
      ...item,
      projectId: item.projectId || projectId,
    })),
    project_timelines: mapObjectValues(state.timelinesByProjectId, (projectId, item) => ({
      ...item,
      projectId,
    })),
    canvas_projects: flattenMapOfArrays(state.canvasProjectsByActorId, (actorId, item) => ({
      ...item,
      actorId: item.actorId || actorId,
    })),
    agent_canvas_projects: flattenMapOfArrays(state.agentCanvasProjectsByActorId, (actorId, item) => ({
      ...item,
      actorId: item.actorId || actorId,
    })),
    playground_conversations: flattenMapOfArrays(
      state.playgroundConversationsByActorId,
      (actorId, item) => ({ ...item, actorId: item.actorId || actorId }),
    ),
    playground_messages: flattenMapOfArrays(
      state.playgroundMessagesByConversationId,
      (conversationId, item) => ({ ...item, conversationId: item.conversationId || conversationId }),
    ),
    playground_memories: flattenMapOfArrays(
      state.playgroundMemoriesByActorId,
      (actorId, item) => ({ ...item, actorId: item.actorId || actorId }),
    ),
    playground_memory_preferences: Object.entries(asObject(state.playgroundMemoryPreferencesByActorId)).map(
      ([actorId, item]) => ({ ...asObject(item), actorId }),
    ),
    playground_chat_jobs: flattenMapOfArrays(
      state.playgroundChatJobsByActorId,
      (actorId, item) => ({ ...item, actorId: item.actorId || actorId }),
    ),
    api_center_vendors: vendors.map((item) => asObject(item)),
    api_center_models: apiModels.map((item) => asObject(item)),
    create_studio_images: asArray(state.createStudioImages).map((item) => asObject(item)),
    create_studio_videos: asArray(state.createStudioVideos).map((item) => asObject(item)),
    enterprise_applications: asArray(state.enterpriseApplications).map((item) => asObject(item)),
    pricing_rules: asArray(state.pricingRules || state.creditPricingRules).map((item) => asObject(item)),
  };
}

async function ensurePostgresSchema(client) {
  if (envFlag("CORE_API_COMPAT_READ_ONLY")) {
    await client.query(COMPAT_READONLY_SCHEMA_SQL);
    await ensureWindowsNativeSchema(client);
    return;
  }

  await client.query(CREATE_SCHEMA_SQL);
  await client.query("ALTER TABLE video_replace_jobs ADD COLUMN IF NOT EXISTS legacy_id text");
  await client.query("CREATE INDEX IF NOT EXISTS idx_video_replace_jobs_legacy_id ON video_replace_jobs(legacy_id)");
  await ensureWindowsNativeSchema(client);
}

async function getTableColumns(client, tableName) {
  const result = await client.query(
    `SELECT column_name, data_type
     FROM information_schema.columns
     WHERE table_schema = current_schema()
       AND table_name = $1`,
    [tableName],
  );
  return new Map(result.rows.map((row) => [row.column_name, row.data_type]));
}

async function assertLegacyProjectionSchema(client) {
  const mismatches = [];
  for (const [tableName, requiredColumns] of Object.entries(LEGACY_PROJECTION_SCHEMA)) {
    const columns = await getTableColumns(client, tableName);
    for (const [columnName, expectedType] of Object.entries(requiredColumns)) {
      const actualType = columns.get(columnName);
      if (!actualType) {
        mismatches.push(`${tableName}.${columnName} missing`);
      } else if (actualType !== expectedType) {
        mismatches.push(`${tableName}.${columnName} is ${actualType}, expected ${expectedType}`);
      }
    }
  }

  if (mismatches.length > 0) {
    throw new Error(
      [
        "core-api legacy projection schema is not compatible with the connected PostgreSQL database.",
        "This usually means core-api write/bootstrap mode is pointing at the Windows-native canonical test database.",
        "Run core-api with CORE_API_COMPAT_READ_ONLY=1 for compatibility smoke tests, or use a separate legacy compatibility database imported with core-api migration scripts.",
        `Mismatches: ${mismatches.join("; ")}`,
      ].join(" "),
    );
  }
}

async function clearProjectedTables(client) {
  for (const table of CORE_TABLES) {
    await client.query(`DELETE FROM ${table}`);
  }
}

async function insertProjectedRows(client, projections) {
  for (const item of projections.users) {
    await client.query(
      `INSERT INTO users (id, email, display_name, platform_role, organization_id, data, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8)`,
      [
        legacyUuid("user", text(item.id) || rowId("user", [item.email, item.displayName])),
        text(item.email),
        text(item.displayName || item.name),
        text(item.platformRole || item.role),
        legacyUuid("organization", item.organizationId || item.defaultOrganizationId),
        JSON.stringify(item),
        text(item.createdAt),
        text(item.updatedAt),
      ],
    );
  }

  for (const item of projections.organizations) {
    await client.query(
      `INSERT INTO organizations (id, name, data, created_at, updated_at)
       VALUES ($1,$2,$3::jsonb,$4,$5)`,
      [
        legacyUuid("organization", text(item.id) || rowId("org", [item.name])),
        text(item.name || item.displayName),
        JSON.stringify(item),
        text(item.createdAt),
        text(item.updatedAt),
      ],
    );
  }

  for (const item of projections.organization_members) {
    await client.query(
      `INSERT INTO organization_members (id, organization_id, user_id, role, data, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7)`,
      [
        legacyUuid("organization_member", text(item.id) || rowId("orgmem", [item.organizationId, item.userId])),
        legacyUuid("organization", item.organizationId),
        legacyUuid("user", item.userId),
        text(item.role),
        JSON.stringify(item),
        text(item.createdAt),
        text(item.updatedAt),
      ],
    );
  }

  for (const item of projections.wallets) {
    await client.query(
      `INSERT INTO wallets (id, owner_type, owner_id, balance, available_credits, frozen_credits, data, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9)`,
      [
        legacyUuid("wallet", text(item.id) || rowId("wallet", [item.ownerType, item.ownerId])),
        text(item.ownerType),
        ownerUuid(item.ownerType, item.ownerId),
        numberOrNull(item.balance ?? item.creditsAvailable),
        numberOrNull(item.availableCredits ?? item.creditsAvailable),
        numberOrNull(item.frozenCredits ?? item.creditsFrozen),
        JSON.stringify(item),
        text(item.createdAt),
        text(item.updatedAt),
      ],
    );
  }

  for (const item of projections.wallet_ledger) {
    await client.query(
      `INSERT INTO wallet_ledger (id, wallet_id, actor_id, entry_type, amount, source_type, source_id, data, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10)`,
      [
        legacyUuid("wallet_ledger", text(item.id) || rowId("ledger", [item.walletId, item.sourceType, item.sourceId, item.createdAt])),
        legacyUuid("wallet", item.walletId),
        legacyUuid("user", item.actorId),
        text(item.entryType || item.changeType),
        numberOrNull(item.amount),
        text(item.sourceType),
        text(item.sourceId || item.orderId || item.taskId),
        JSON.stringify(item),
        text(item.createdAt),
        text(item.updatedAt),
      ],
    );
  }

  for (const item of projections.wallet_recharge_orders) {
    await client.query(
      `INSERT INTO wallet_recharge_orders (id, actor_id, wallet_id, payment_method, mode, status, amount, credits, provider_trade_no, data, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12)`,
      [
        legacyUuid("wallet_recharge_order", text(item.id) || rowId("order", [item.providerTradeNo, item.createdAt])),
        legacyUuid("user", item.actorId),
        legacyUuid("wallet", item.walletId),
        text(item.paymentMethod),
        text(item.mode),
        text(item.status),
        numberOrNull(item.amount),
        numberOrNull(item.credits),
        text(item.providerTradeNo),
        JSON.stringify(item),
        text(item.createdAt),
        text(item.updatedAt),
      ],
    );
  }

  for (const item of projections.projects) {
    await client.query(
      `INSERT INTO projects (id, owner_type, owner_id, title, status, organization_id, data, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9)`,
      [
        legacyUuid("project", text(item.id) || rowId("project", [item.title, item.createdAt])),
        text(item.ownerType),
        ownerUuid(item.ownerType, item.ownerId || item.createdBy),
        text(item.title || item.name),
        text(item.status),
        legacyUuid("organization", item.organizationId),
        JSON.stringify(item),
        text(item.createdAt),
        text(item.updatedAt),
      ],
    );
  }

  for (const item of projections.tasks) {
    await client.query(
      `INSERT INTO tasks (id, project_id, actor_id, type, action_code, status, wallet_id, data, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10)`,
      [
        legacyUuid("task", text(item.id) || rowId("task", [item.type, item.projectId, item.createdAt])),
        legacyUuid("project", item.projectId),
        legacyUuid("user", item.actorId),
        text(item.type),
        text(item.actionCode),
        text(item.status),
        legacyUuid("wallet", item.walletId),
        JSON.stringify(item),
        text(item.createdAt),
        text(item.updatedAt),
      ],
    );
  }

  for (const item of projections.project_settings) {
    await client.query(
      `INSERT INTO project_settings (project_id, data, updated_at)
       VALUES ($1,$2::jsonb,$3)`,
      [legacyUuid("project", item.projectId), JSON.stringify(item), text(item.updatedAt)],
    );
  }

  for (const item of projections.project_scripts) {
    await client.query(
      `INSERT INTO project_scripts (id, project_id, title, version, data, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7)`,
      [
        legacyUuid("project_script", text(item.id) || rowId("script", [item.projectId])),
        legacyUuid("project", item.projectId),
        text(item.title || item.name),
        numberOrNull(item.version),
        JSON.stringify(item),
        text(item.createdAt),
        text(item.updatedAt),
      ],
    );
  }

  for (const item of projections.project_assets) {
    await client.query(
      `INSERT INTO project_assets (id, project_id, asset_type, name, scope, data, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8)`,
      [
        legacyUuid("asset", text(item.id) || rowId("asset", [item.projectId, item.name, item.createdAt])),
        legacyUuid("project", item.projectId),
        text(item.assetType || item.type || item.kind),
        text(item.name || item.title || item.filename),
        text(item.scope),
        JSON.stringify(item),
        text(item.createdAt),
        text(item.updatedAt),
      ],
    );
  }

  for (const item of projections.storyboards) {
    await client.query(
      `INSERT INTO storyboards (id, project_id, shot_no, title, image_status, video_status, data, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9)`,
      [
        legacyUuid("storyboard", text(item.id) || rowId("storyboard", [item.projectId, item.shotNo, item.createdAt])),
        legacyUuid("project", item.projectId),
        numberOrNull(item.shotNo ?? item.index ?? item.order),
        text(item.title || item.name),
        text(item.imageStatus),
        text(item.videoStatus),
        JSON.stringify(item),
        text(item.createdAt),
        text(item.updatedAt),
      ],
    );
  }

  for (const item of projections.videos) {
    await client.query(
      `INSERT INTO videos (id, project_id, storyboard_id, status, video_url, data, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8)`,
      [
        legacyUuid("video", text(item.id) || rowId("video", [item.projectId, item.storyboardId, item.createdAt])),
        legacyUuid("project", item.projectId),
        legacyUuid("storyboard", item.storyboardId),
        text(item.status),
        text(item.videoUrl || item.outputUrl || item.url),
        JSON.stringify(item),
        text(item.createdAt),
        text(item.updatedAt),
      ],
    );
  }

  for (const item of projections.dubbings) {
    await client.query(
      `INSERT INTO dubbings (id, project_id, storyboard_id, status, audio_url, data, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8)`,
      [
        legacyUuid("dubbing", text(item.id) || rowId("dubbing", [item.projectId, item.storyboardId, item.createdAt])),
        legacyUuid("project", item.projectId),
        legacyUuid("storyboard", item.storyboardId),
        text(item.status),
        text(item.audioUrl || item.outputUrl || item.url),
        JSON.stringify(item),
        text(item.createdAt),
        text(item.updatedAt),
      ],
    );
  }

  for (const item of projections.project_timelines) {
    await client.query(
      `INSERT INTO project_timelines (project_id, version, data, updated_at)
       VALUES ($1,$2,$3::jsonb,$4)`,
      [legacyUuid("project", item.projectId), numberOrNull(item.version), JSON.stringify(item), text(item.updatedAt)],
    );
  }

  for (const item of projections.canvas_projects) {
    await client.query(
      `INSERT INTO canvas_projects (id, actor_id, title, data, created_at, updated_at)
       VALUES ($1,$2,$3,$4::jsonb,$5,$6)`,
      [
        legacyUuid("canvas", text(item.id) || rowId("canvas", [item.actorId, item.title, item.createdAt])),
        legacyUuid("user", item.actorId),
        text(item.title),
        JSON.stringify(item),
        text(item.createdAt),
        text(item.updatedAt),
      ],
    );
  }

  for (const item of projections.agent_canvas_projects) {
    await client.query(
      `INSERT INTO agent_canvas_projects (id, actor_id, title, data, created_at, updated_at)
       VALUES ($1,$2,$3,$4::jsonb,$5,$6)`,
      [
        legacyUuid("agent_canvas", text(item.id) || rowId("agentcanvas", [item.actorId, item.title, item.createdAt])),
        legacyUuid("user", item.actorId),
        text(item.title),
        JSON.stringify(item),
        text(item.createdAt),
        text(item.updatedAt),
      ],
    );
  }

  for (const item of projections.playground_conversations) {
    await client.query(
      `INSERT INTO playground_conversations (id, actor_id, title, model, data, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7)`,
      [
        text(item.id) || rowId("pgconv", [item.actorId, item.createdAt]),
        text(item.actorId),
        text(item.title),
        text(item.model),
        JSON.stringify(item),
        text(item.createdAt),
        text(item.updatedAt),
      ],
    );
  }

  for (const item of projections.playground_messages) {
    await client.query(
      `INSERT INTO playground_messages (id, conversation_id, actor_id, role, status, data, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8)`,
      [
        text(item.id) || rowId("pgmsg", [item.conversationId, item.role, item.createdAt]),
        text(item.conversationId),
        text(item.actorId),
        text(item.role),
        text(item.status),
        JSON.stringify(item),
        text(item.createdAt),
        text(item.updatedAt),
      ],
    );
  }

  for (const item of projections.playground_memories) {
    await client.query(
      `INSERT INTO playground_memories (id, actor_id, memory_key, memory_value, data, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7)`,
      [
        text(item.id) || rowId("pgmem", [item.actorId, item.key]),
        text(item.actorId),
        text(item.key),
        text(item.value),
        JSON.stringify(item),
        text(item.createdAt),
        text(item.updatedAt),
      ],
    );
  }

  for (const item of projections.playground_memory_preferences) {
    await client.query(
      `INSERT INTO playground_memory_preferences (actor_id, enabled, data, updated_at)
       VALUES ($1,$2,$3::jsonb,$4)`,
      [text(item.actorId), item.enabled === undefined ? null : Boolean(item.enabled), JSON.stringify(item), text(item.updatedAt)],
    );
  }

  for (const item of projections.playground_chat_jobs) {
    await client.query(
      `INSERT INTO playground_chat_jobs (id, actor_id, conversation_id, status, data, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7)`,
      [
        text(item.id) || rowId("pgjob", [item.actorId, item.conversationId, item.createdAt]),
        text(item.actorId),
        text(item.conversationId),
        text(item.status),
        JSON.stringify(item),
        text(item.createdAt),
        text(item.updatedAt),
      ],
    );
  }

  for (const item of projections.api_center_vendors) {
    await client.query(
      `INSERT INTO api_center_vendors (id, name, connected, data, updated_at)
       VALUES ($1,$2,$3,$4::jsonb,$5)`,
      [text(item.id), text(item.name), item.connected === undefined ? null : Boolean(item.connected), JSON.stringify(item), text(item.updatedAt || item.lastCheckedAt || item.testedAt)],
    );
  }

  for (const item of projections.api_center_models) {
    await client.query(
      `INSERT INTO api_center_models (id, vendor_id, name, domain, enabled, data, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7)`,
      [
        text(`${item.vendorId}:${item.id}`),
        text(item.vendorId),
        text(item.name),
        text(item.domain),
        item.enabled === undefined ? null : Boolean(item.enabled),
        JSON.stringify(item),
        text(item.updatedAt),
      ],
    );
  }

  for (const item of projections.create_studio_images) {
    await client.query(
      `INSERT INTO create_studio_images (id, actor_id, task_id, model, prompt, image_url, data, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9)`,
      [
        legacyUuid("create_image", text(item.id) || rowId("createimage", [item.actorId || item.ownerId, item.taskId, item.createdAt])),
        legacyUuid("user", item.actorId || item.ownerId || item.userId),
        legacyUuid("task", item.taskId),
        text(item.model || item.modelId),
        text(item.prompt || item.positivePrompt),
        text(item.imageUrl || item.outputUrl || item.url),
        JSON.stringify(item),
        text(item.createdAt),
        text(item.updatedAt),
      ],
    );
  }

  for (const item of projections.create_studio_videos) {
    await client.query(
      `INSERT INTO create_studio_videos (id, actor_id, task_id, model, prompt, video_url, data, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9)`,
      [
        legacyUuid("create_video", text(item.id) || rowId("createvideo", [item.actorId || item.ownerId, item.taskId, item.createdAt])),
        legacyUuid("user", item.actorId || item.ownerId || item.userId),
        legacyUuid("task", item.taskId),
        text(item.model || item.modelId),
        text(item.prompt || item.positivePrompt),
        text(item.videoUrl || item.outputUrl || item.url),
        JSON.stringify(item),
        text(item.createdAt),
        text(item.updatedAt),
      ],
    );
  }

  for (const item of projections.enterprise_applications) {
    await client.query(
      `INSERT INTO enterprise_applications (id, company_name, contact_name, phone, email, status, data, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9)`,
      [
        text(item.id) || rowId("enterprise", [item.companyName, item.contactName, item.createdAt]),
        text(item.companyName || item.organizationName),
        text(item.contactName || item.name),
        text(item.phone || item.mobile),
        text(item.email),
        text(item.status),
        JSON.stringify(item),
        text(item.createdAt),
        text(item.updatedAt),
      ],
    );
  }

  for (const item of projections.pricing_rules) {
    await client.query(
      `INSERT INTO pricing_rules (action_code, credits, data, updated_at)
       VALUES ($1,$2,$3::jsonb,$4)`,
      [
        text(item.actionCode || item.code || item.id),
        numberOrNull(item.credits || item.creditCost || item.amount),
        JSON.stringify(item),
        text(item.updatedAt),
      ],
    );
  }
}

async function writeAuditRows(client, source, projections) {
  for (const [entity, rows] of Object.entries(projections)) {
    const entityChecksum = checksum(rows);
    await client.query(
      `INSERT INTO migration_audit (source, entity, source_count, target_count, checksum)
       VALUES ($1,$2,$3,$4,$5)`,
      [source, entity, rows.length, rows.length, entityChecksum],
    );
  }
}

async function syncSnapshotProjections(client, snapshot, options = {}) {
  const source = options.source || "runtime";
  const projections = projectSnapshot(snapshot);
  await assertLegacyProjectionSchema(client);
  if (options.replace !== false) {
    await clearProjectedTables(client);
  }
  await insertProjectedRows(client, projections);
  if (options.audit !== false) {
    await writeAuditRows(client, source, projections);
  }
  return projections;
}

module.exports = {
  CORE_TABLES,
  assertLegacyProjectionSchema,
  checksum,
  ensurePostgresSchema,
  projectSnapshot,
  syncSnapshotProjections,
};
