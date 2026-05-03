-- XiaoLouAI P0 Windows-native canonical schema.
-- PostgreSQL is the only source of truth for jobs, payments, wallet ledger,
-- media metadata, outbox, and provider health. This migration is additive and
-- intentionally keeps legacy tables readable during cutover.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
BEGIN
  CREATE TYPE job_status AS ENUM (
    'queued',
    'leased',
    'running',
    'succeeded',
    'failed',
    'cancelled',
    'retry_waiting'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE payment_order_status AS ENUM (
    'created',
    'pending',
    'paid',
    'failed',
    'expired',
    'cancelled',
    'refunded'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_type text NOT NULL DEFAULT 'user' CHECK (account_type IN ('user', 'organization', 'system')),
  legacy_owner_type text,
  legacy_owner_id text,
  status text NOT NULL DEFAULT 'active',
  region_code text NOT NULL DEFAULT 'CN',
  default_currency text NOT NULL DEFAULT 'CNY',
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_accounts_legacy_owner
  ON accounts(legacy_owner_type, legacy_owner_id)
  WHERE legacy_owner_type IS NOT NULL AND legacy_owner_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid REFERENCES accounts(id),
  email text,
  phone_hash text,
  display_name text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'active',
  region_code text NOT NULL DEFAULT 'CN',
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS account_id uuid;
ALTER TABLE users ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active';
ALTER TABLE users ADD COLUMN IF NOT EXISTS region_code text NOT NULL DEFAULT 'CN';
CREATE INDEX IF NOT EXISTS idx_users_account_id ON users(account_id);

CREATE TABLE IF NOT EXISTS organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid REFERENCES accounts(id),
  name text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'active',
  region_code text NOT NULL DEFAULT 'CN',
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE organizations ADD COLUMN IF NOT EXISTS account_id uuid;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active';
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS region_code text NOT NULL DEFAULT 'CN';
CREATE INDEX IF NOT EXISTS idx_organizations_account_id ON organizations(account_id);

CREATE TABLE IF NOT EXISTS organization_memberships (
  organization_account_id uuid NOT NULL REFERENCES accounts(id),
  user_account_id uuid NOT NULL REFERENCES accounts(id),
  legacy_organization_id text,
  legacy_user_id text,
  role text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_account_id, user_account_id)
);

CREATE TABLE IF NOT EXISTS api_center_configs (
  account_id uuid PRIMARY KEY REFERENCES accounts(id),
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS enterprise_applications (
  id text PRIMARY KEY,
  company_name text NOT NULL DEFAULT '',
  contact_name text NOT NULL DEFAULT '',
  phone text NOT NULL DEFAULT '',
  email text,
  status text NOT NULL DEFAULT 'submitted',
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_enterprise_applications_status
  ON enterprise_applications(status, created_at DESC);

CREATE TABLE IF NOT EXISTS pricing_rules (
  action_code text PRIMARY KEY,
  credits numeric(18,4) NOT NULL DEFAULT 0,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO pricing_rules (action_code, credits, data)
VALUES
  ('storyboard_image_generate', 1, '{"id":"storyboard-image-generate","actionCode":"storyboard_image_generate","label":"Storyboard image generation","baseCredits":1,"credits":1,"unitLabel":"image","description":"Canonical storyboard image generation display price.","source":"canonical-default"}'::jsonb),
  ('canvas_image_generate', 1, '{"id":"canvas-image-generate","actionCode":"canvas_image_generate","label":"Canvas image generation","baseCredits":1,"credits":1,"unitLabel":"image","description":"Canonical canvas image generation display price.","source":"canonical-default"}'::jsonb),
  ('video_generate', 8, '{"id":"video-generate","actionCode":"video_generate","label":"Video generation","baseCredits":8,"credits":8,"unitLabel":"job","description":"Canonical video generation display price.","source":"canonical-default"}'::jsonb)
ON CONFLICT (action_code) DO NOTHING;

CREATE TABLE IF NOT EXISTS media_objects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id),
  bucket text NOT NULL,
  object_key text NOT NULL,
  permanent_object_key text,
  storage_class text NOT NULL DEFAULT 'standard',
  media_type text NOT NULL,
  content_type text,
  byte_size bigint,
  checksum_sha256 text,
  status text NOT NULL DEFAULT 'temporary',
  data_sensitivity text NOT NULL DEFAULT 'normal',
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_media_bucket_key UNIQUE (bucket, object_key)
);

ALTER TABLE media_objects ADD COLUMN IF NOT EXISTS account_id uuid REFERENCES accounts(id);
ALTER TABLE media_objects ADD COLUMN IF NOT EXISTS bucket text NOT NULL DEFAULT '';
ALTER TABLE media_objects ADD COLUMN IF NOT EXISTS object_key text NOT NULL DEFAULT '';
ALTER TABLE media_objects ADD COLUMN IF NOT EXISTS permanent_object_key text;
ALTER TABLE media_objects ADD COLUMN IF NOT EXISTS storage_class text NOT NULL DEFAULT 'standard';
ALTER TABLE media_objects ADD COLUMN IF NOT EXISTS media_type text NOT NULL DEFAULT 'file';
ALTER TABLE media_objects ADD COLUMN IF NOT EXISTS content_type text;
ALTER TABLE media_objects ADD COLUMN IF NOT EXISTS byte_size bigint;
ALTER TABLE media_objects ADD COLUMN IF NOT EXISTS checksum_sha256 text;
ALTER TABLE media_objects ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'temporary';
ALTER TABLE media_objects ADD COLUMN IF NOT EXISTS data_sensitivity text NOT NULL DEFAULT 'normal';
ALTER TABLE media_objects ADD COLUMN IF NOT EXISTS data jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE media_objects ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE media_objects ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_media_objects_account_status
  ON media_objects(account_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS upload_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id),
  media_object_id uuid REFERENCES media_objects(id),
  idempotency_key text NOT NULL,
  status text NOT NULL DEFAULT 'begun',
  upload_url_expires_at timestamptz NOT NULL,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CONSTRAINT uq_upload_sessions_account_idempotency UNIQUE (account_id, idempotency_key)
);

ALTER TABLE upload_sessions ADD COLUMN IF NOT EXISTS account_id uuid REFERENCES accounts(id);
ALTER TABLE upload_sessions ADD COLUMN IF NOT EXISTS media_object_id uuid REFERENCES media_objects(id);
ALTER TABLE upload_sessions ADD COLUMN IF NOT EXISTS idempotency_key text NOT NULL DEFAULT '';
ALTER TABLE upload_sessions ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'begun';
ALTER TABLE upload_sessions ADD COLUMN IF NOT EXISTS upload_url_expires_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE upload_sessions ADD COLUMN IF NOT EXISTS data jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE upload_sessions ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE upload_sessions ADD COLUMN IF NOT EXISTS completed_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_upload_sessions_status_expiry
  ON upload_sessions(status, upload_url_expires_at);

CREATE TABLE IF NOT EXISTS jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id),
  created_by_user_id text,
  lane text NOT NULL CHECK (lane IN ('account-finance', 'account-control', 'account-media')),
  job_type text NOT NULL,
  provider_route text,
  status job_status NOT NULL DEFAULT 'queued',
  priority integer NOT NULL DEFAULT 0,
  idempotency_key text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  result jsonb NOT NULL DEFAULT '{}'::jsonb,
  media_object_id uuid REFERENCES media_objects(id),
  lease_owner text,
  lease_until timestamptz,
  run_after timestamptz NOT NULL DEFAULT now(),
  attempt_count integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 3,
  timeout_seconds integer NOT NULL DEFAULT 1800,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  cancelled_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_jobs_account_lane_idempotency
  ON jobs(account_id, lane, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_jobs_lease_pick
    ON jobs(lane, status, run_after, priority DESC, created_at)
    WHERE status IN ('queued', 'retry_waiting');

CREATE INDEX IF NOT EXISTS ix_jobs_lease_pick_provider
    ON jobs(lane, provider_route, status, run_after, priority DESC, created_at)
    WHERE status IN ('queued', 'retry_waiting');

CREATE INDEX IF NOT EXISTS ix_jobs_lease_timeout
    ON jobs(status, lease_until)
    WHERE status IN ('leased', 'running');

CREATE INDEX IF NOT EXISTS ix_jobs_account_status
  ON jobs(account_id, status, created_at DESC);

-- Supports the lease query that excludes already-active jobs for the same
-- account/lane before picking the next PostgreSQL queued job.
CREATE INDEX IF NOT EXISTS ix_jobs_account_lane_active
  ON jobs(account_id, lane, status, lease_until)
  WHERE status IN ('leased', 'running');

CREATE TABLE IF NOT EXISTS job_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES jobs(id),
  attempt_no integer NOT NULL,
  worker_id text NOT NULL,
  status text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  heartbeat_at timestamptz,
  finished_at timestamptz,
  error text,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT uq_job_attempt_no UNIQUE (job_id, attempt_no)
);

CREATE INDEX IF NOT EXISTS idx_job_attempts_job_started
  ON job_attempts(job_id, started_at DESC);

CREATE TABLE IF NOT EXISTS toolbox_capabilities (
  code text PRIMARY KEY,
  name text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'local',
  queue text NOT NULL DEFAULT 'canonical-jobs',
  description text NOT NULL DEFAULT '',
  sort_order integer NOT NULL DEFAULT 100,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE toolbox_capabilities ADD COLUMN IF NOT EXISTS name text NOT NULL DEFAULT '';
ALTER TABLE toolbox_capabilities ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'local';
ALTER TABLE toolbox_capabilities ADD COLUMN IF NOT EXISTS queue text NOT NULL DEFAULT 'canonical-jobs';
ALTER TABLE toolbox_capabilities ADD COLUMN IF NOT EXISTS description text NOT NULL DEFAULT '';
ALTER TABLE toolbox_capabilities ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 100;
ALTER TABLE toolbox_capabilities ADD COLUMN IF NOT EXISTS data jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE toolbox_capabilities ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE toolbox_capabilities ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

INSERT INTO toolbox_capabilities (code, name, status, queue, description, sort_order, data)
VALUES
  ('video_character_replace', 'Script breakdown prompt', 'local', 'canonical-jobs', 'Frontend entry retained; no legacy toolbox write route is used.', 10, '{"source":"canonical-default"}'::jsonb),
  ('character_replace', 'Character replace', 'local', 'canonical-jobs', 'Queued through the Windows-native Control API toolbox surface.', 20, '{"source":"canonical-default"}'::jsonb),
  ('motion_transfer', 'Motion transfer', 'coming_soon', 'canonical-jobs', 'Reserved for canonical job execution after worker/provider evidence is available.', 30, '{"source":"canonical-default"}'::jsonb),
  ('upscale_restore', 'Video reverse prompt', 'local', 'canonical-jobs', 'Reverse prompt entry is routed through canonical toolbox jobs.', 40, '{"source":"canonical-default"}'::jsonb),
  ('storyboard_25', '25-grid storyboard', 'local', 'canonical-jobs', 'Storyboard grid entry is routed through canonical toolbox jobs.', 50, '{"source":"canonical-default"}'::jsonb)
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  status = EXCLUDED.status,
  queue = EXCLUDED.queue,
  description = EXCLUDED.description,
  sort_order = EXCLUDED.sort_order,
  data = toolbox_capabilities.data || EXCLUDED.data,
  updated_at = now();

CREATE TABLE IF NOT EXISTS toolbox_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id),
  job_id uuid NOT NULL REFERENCES jobs(id),
  actor_id text NOT NULL DEFAULT 'guest',
  capability_code text NOT NULL,
  input_summary text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'queued',
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  result jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE toolbox_runs ADD COLUMN IF NOT EXISTS account_id uuid REFERENCES accounts(id);
ALTER TABLE toolbox_runs ADD COLUMN IF NOT EXISTS job_id uuid REFERENCES jobs(id);
ALTER TABLE toolbox_runs ADD COLUMN IF NOT EXISTS actor_id text NOT NULL DEFAULT 'guest';
ALTER TABLE toolbox_runs ADD COLUMN IF NOT EXISTS capability_code text NOT NULL DEFAULT '';
ALTER TABLE toolbox_runs ADD COLUMN IF NOT EXISTS input_summary text NOT NULL DEFAULT '';
ALTER TABLE toolbox_runs ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'queued';
ALTER TABLE toolbox_runs ADD COLUMN IF NOT EXISTS payload jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE toolbox_runs ADD COLUMN IF NOT EXISTS result jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE toolbox_runs ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE toolbox_runs ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE UNIQUE INDEX IF NOT EXISTS uq_toolbox_runs_job
  ON toolbox_runs(job_id);

CREATE INDEX IF NOT EXISTS idx_toolbox_runs_account_created
  ON toolbox_runs(account_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_toolbox_runs_capability_created
  ON toolbox_runs(capability_code, created_at DESC);

CREATE TABLE IF NOT EXISTS payment_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id),
  legacy_recharge_order_id text,
  provider text NOT NULL,
  merchant_order_no text NOT NULL,
  provider_trade_no text,
  idempotency_key text NOT NULL,
  status payment_order_status NOT NULL DEFAULT 'created',
  amount_cents bigint NOT NULL CHECK (amount_cents > 0),
  credit_amount numeric(18,4) NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'CNY',
  paid_at timestamptz,
  expires_at timestamptz,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_payment_orders_merchant_order UNIQUE (merchant_order_no),
  CONSTRAINT uq_payment_orders_account_idempotency UNIQUE (account_id, idempotency_key)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_orders_legacy_recharge
  ON payment_orders(legacy_recharge_order_id)
  WHERE legacy_recharge_order_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_orders_provider_trade
  ON payment_orders(provider, provider_trade_no)
  WHERE provider_trade_no IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_payment_orders_account_status
  ON payment_orders(account_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS payment_callbacks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  event_id text NOT NULL,
  merchant_order_no text,
  provider_trade_no text,
  signature_valid boolean NOT NULL DEFAULT false,
  processing_status text NOT NULL DEFAULT 'received',
  raw_body_hash text NOT NULL,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  error text,
  CONSTRAINT uq_payment_callbacks_provider_event UNIQUE (provider, event_id)
);

CREATE INDEX IF NOT EXISTS idx_payment_callbacks_processing_status
  ON payment_callbacks(processing_status, received_at);

CREATE TABLE IF NOT EXISTS wallet_balances (
  account_id uuid NOT NULL REFERENCES accounts(id),
  currency text NOT NULL DEFAULT 'CNY',
  balance_cents bigint NOT NULL DEFAULT 0,
  credit_balance numeric(18,4) NOT NULL DEFAULT 0,
  ledger_version bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, currency)
);

CREATE TABLE IF NOT EXISTS wallet_ledger (
  id text PRIMARY KEY,
  wallet_id text,
  actor_id text,
  entry_type text NOT NULL,
  amount numeric(18,4) NOT NULL DEFAULT 0,
  source_type text,
  source_id text,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE wallet_ledger ADD COLUMN IF NOT EXISTS account_id uuid;
ALTER TABLE wallet_ledger ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'CNY';
ALTER TABLE wallet_ledger ADD COLUMN IF NOT EXISTS amount_cents bigint;
ALTER TABLE wallet_ledger ADD COLUMN IF NOT EXISTS credit_amount numeric(18,4);
ALTER TABLE wallet_ledger ADD COLUMN IF NOT EXISTS balance_after_cents bigint;
ALTER TABLE wallet_ledger ADD COLUMN IF NOT EXISTS balance_after_credits numeric(18,4);
ALTER TABLE wallet_ledger ADD COLUMN IF NOT EXISTS payment_order_id uuid;
ALTER TABLE wallet_ledger ADD COLUMN IF NOT EXISTS idempotency_key text;
ALTER TABLE wallet_ledger ADD COLUMN IF NOT EXISTS immutable boolean NOT NULL DEFAULT true;

CREATE INDEX IF NOT EXISTS idx_wallet_ledger_account_created
  ON wallet_ledger(account_id, created_at)
  WHERE account_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_wallet_ledger_account_source
  ON wallet_ledger(account_id, source_type, source_id)
  WHERE account_id IS NOT NULL AND source_type IS NOT NULL AND source_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_wallet_ledger_account_idempotency
  ON wallet_ledger(account_id, idempotency_key)
  WHERE account_id IS NOT NULL AND idempotency_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS outbox_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aggregate_type text NOT NULL,
  aggregate_id text NOT NULL,
  event_type text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  locked_by text,
  locked_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz
);

ALTER TABLE outbox_events ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0;
ALTER TABLE outbox_events ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE outbox_events ADD COLUMN IF NOT EXISTS locked_by text;
ALTER TABLE outbox_events ADD COLUMN IF NOT EXISTS locked_until timestamptz;
ALTER TABLE outbox_events ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE outbox_events ADD COLUMN IF NOT EXISTS published_at timestamptz;

CREATE INDEX IF NOT EXISTS ix_outbox_pick
  ON outbox_events(status, next_attempt_at, created_at)
  WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS provider_health (
  provider text NOT NULL,
  region_code text NOT NULL DEFAULT 'global',
  model_family text NOT NULL DEFAULT 'default',
  status text NOT NULL DEFAULT 'unknown',
  success_rate numeric(6,4),
  p95_latency_ms integer,
  cost_score numeric(10,4),
  last_success_at timestamptz,
  last_failure_at timestamptz,
  last_error text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, region_code, model_family)
);

CREATE TABLE IF NOT EXISTS projects (
  id text PRIMARY KEY,
  account_id uuid REFERENCES accounts(id),
  owner_type text,
  owner_id text,
  title text,
  summary text,
  status text,
  cover_url text,
  organization_id text,
  current_step text,
  progress_percent numeric,
  budget_credits numeric,
  budget_limit_credits numeric,
  budget_used_credits numeric,
  billing_wallet_type text,
  billing_policy text,
  created_by_user_id text,
  director_agent_name text,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at text,
  updated_at text
);

ALTER TABLE projects ADD COLUMN IF NOT EXISTS account_id uuid REFERENCES accounts(id);
ALTER TABLE projects ADD COLUMN IF NOT EXISTS summary text;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS cover_url text;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS current_step text;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS progress_percent numeric;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS budget_credits numeric;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS budget_limit_credits numeric;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS budget_used_credits numeric;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS billing_wallet_type text;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS billing_policy text;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS created_by_user_id text;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS director_agent_name text;

CREATE INDEX IF NOT EXISTS idx_projects_account_updated
  ON projects(account_id, updated_at)
  WHERE account_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_projects_owner
  ON projects(owner_type, owner_id);

CREATE TABLE IF NOT EXISTS project_settings (
  project_id text PRIMARY KEY,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at text
);

CREATE TABLE IF NOT EXISTS project_scripts (
  id text PRIMARY KEY,
  project_id text,
  title text,
  version integer,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at text,
  updated_at text
);

CREATE INDEX IF NOT EXISTS idx_project_scripts_project
  ON project_scripts(project_id, version DESC);

CREATE TABLE IF NOT EXISTS project_timelines (
  project_id text PRIMARY KEY,
  version integer,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at text
);

CREATE TABLE IF NOT EXISTS project_assets (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  asset_type text,
  name text,
  description text,
  preview_url text,
  media_kind text,
  media_url text,
  source_task_id text,
  source_module text,
  source_metadata jsonb,
  generation_prompt text,
  reference_image_urls jsonb,
  image_status text,
  image_model text,
  aspect_ratio text,
  negative_prompt text,
  scope text,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at text,
  updated_at text
);

ALTER TABLE project_assets ADD COLUMN IF NOT EXISTS project_id text;
ALTER TABLE project_assets ADD COLUMN IF NOT EXISTS asset_type text;
ALTER TABLE project_assets ADD COLUMN IF NOT EXISTS name text;
ALTER TABLE project_assets ADD COLUMN IF NOT EXISTS description text;
ALTER TABLE project_assets ADD COLUMN IF NOT EXISTS preview_url text;
ALTER TABLE project_assets ADD COLUMN IF NOT EXISTS media_kind text;
ALTER TABLE project_assets ADD COLUMN IF NOT EXISTS media_url text;
ALTER TABLE project_assets ADD COLUMN IF NOT EXISTS source_task_id text;
ALTER TABLE project_assets ADD COLUMN IF NOT EXISTS source_module text;
ALTER TABLE project_assets ADD COLUMN IF NOT EXISTS source_metadata jsonb;
ALTER TABLE project_assets ADD COLUMN IF NOT EXISTS generation_prompt text;
ALTER TABLE project_assets ADD COLUMN IF NOT EXISTS reference_image_urls jsonb;
ALTER TABLE project_assets ADD COLUMN IF NOT EXISTS image_status text;
ALTER TABLE project_assets ADD COLUMN IF NOT EXISTS image_model text;
ALTER TABLE project_assets ADD COLUMN IF NOT EXISTS aspect_ratio text;
ALTER TABLE project_assets ADD COLUMN IF NOT EXISTS negative_prompt text;
ALTER TABLE project_assets ADD COLUMN IF NOT EXISTS scope text;
ALTER TABLE project_assets ADD COLUMN IF NOT EXISTS data jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE project_assets ADD COLUMN IF NOT EXISTS created_at text;
ALTER TABLE project_assets ADD COLUMN IF NOT EXISTS updated_at text;

CREATE INDEX IF NOT EXISTS idx_project_assets_project_updated
  ON project_assets(project_id, updated_at);

CREATE INDEX IF NOT EXISTS idx_project_assets_project_type
  ON project_assets(project_id, asset_type);

CREATE TABLE IF NOT EXISTS project_storyboards (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  shot_no integer,
  episode_no integer,
  title text,
  script text,
  image_status text,
  video_status text,
  duration_seconds numeric,
  prompt_summary text,
  image_url text,
  asset_ids jsonb,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at text,
  updated_at text
);

ALTER TABLE project_storyboards ADD COLUMN IF NOT EXISTS project_id text;
ALTER TABLE project_storyboards ADD COLUMN IF NOT EXISTS shot_no integer;
ALTER TABLE project_storyboards ADD COLUMN IF NOT EXISTS episode_no integer;
ALTER TABLE project_storyboards ADD COLUMN IF NOT EXISTS title text;
ALTER TABLE project_storyboards ADD COLUMN IF NOT EXISTS script text;
ALTER TABLE project_storyboards ADD COLUMN IF NOT EXISTS image_status text;
ALTER TABLE project_storyboards ADD COLUMN IF NOT EXISTS video_status text;
ALTER TABLE project_storyboards ADD COLUMN IF NOT EXISTS duration_seconds numeric;
ALTER TABLE project_storyboards ADD COLUMN IF NOT EXISTS prompt_summary text;
ALTER TABLE project_storyboards ADD COLUMN IF NOT EXISTS image_url text;
ALTER TABLE project_storyboards ADD COLUMN IF NOT EXISTS asset_ids jsonb;
ALTER TABLE project_storyboards ADD COLUMN IF NOT EXISTS data jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE project_storyboards ADD COLUMN IF NOT EXISTS created_at text;
ALTER TABLE project_storyboards ADD COLUMN IF NOT EXISTS updated_at text;

CREATE INDEX IF NOT EXISTS idx_project_storyboards_project_shot
  ON project_storyboards(project_id, episode_no, shot_no);

CREATE TABLE IF NOT EXISTS project_videos (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  storyboard_id text,
  version integer,
  status text,
  duration_seconds numeric,
  video_url text,
  thumbnail_url text,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at text,
  updated_at text
);

ALTER TABLE project_videos ADD COLUMN IF NOT EXISTS project_id text;
ALTER TABLE project_videos ADD COLUMN IF NOT EXISTS storyboard_id text;
ALTER TABLE project_videos ADD COLUMN IF NOT EXISTS version integer;
ALTER TABLE project_videos ADD COLUMN IF NOT EXISTS status text;
ALTER TABLE project_videos ADD COLUMN IF NOT EXISTS duration_seconds numeric;
ALTER TABLE project_videos ADD COLUMN IF NOT EXISTS video_url text;
ALTER TABLE project_videos ADD COLUMN IF NOT EXISTS thumbnail_url text;
ALTER TABLE project_videos ADD COLUMN IF NOT EXISTS data jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE project_videos ADD COLUMN IF NOT EXISTS created_at text;
ALTER TABLE project_videos ADD COLUMN IF NOT EXISTS updated_at text;

CREATE INDEX IF NOT EXISTS idx_project_videos_project_storyboard
  ON project_videos(project_id, storyboard_id, updated_at);

CREATE TABLE IF NOT EXISTS project_dubbings (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  storyboard_id text,
  speaker_name text,
  voice_preset text,
  text_content text,
  status text,
  audio_url text,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at text,
  updated_at text
);

ALTER TABLE project_dubbings ADD COLUMN IF NOT EXISTS project_id text;
ALTER TABLE project_dubbings ADD COLUMN IF NOT EXISTS storyboard_id text;
ALTER TABLE project_dubbings ADD COLUMN IF NOT EXISTS speaker_name text;
ALTER TABLE project_dubbings ADD COLUMN IF NOT EXISTS voice_preset text;
ALTER TABLE project_dubbings ADD COLUMN IF NOT EXISTS text_content text;
ALTER TABLE project_dubbings ADD COLUMN IF NOT EXISTS status text;
ALTER TABLE project_dubbings ADD COLUMN IF NOT EXISTS audio_url text;
ALTER TABLE project_dubbings ADD COLUMN IF NOT EXISTS data jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE project_dubbings ADD COLUMN IF NOT EXISTS created_at text;
ALTER TABLE project_dubbings ADD COLUMN IF NOT EXISTS updated_at text;

CREATE INDEX IF NOT EXISTS idx_project_dubbings_project_storyboard
  ON project_dubbings(project_id, storyboard_id, updated_at);

CREATE TABLE IF NOT EXISTS project_exports (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  format text,
  status text,
  job_id uuid,
  output_url text,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at text,
  updated_at text
);

ALTER TABLE project_exports ADD COLUMN IF NOT EXISTS project_id text;
ALTER TABLE project_exports ADD COLUMN IF NOT EXISTS format text;
ALTER TABLE project_exports ADD COLUMN IF NOT EXISTS status text;
ALTER TABLE project_exports ADD COLUMN IF NOT EXISTS job_id uuid;
ALTER TABLE project_exports ADD COLUMN IF NOT EXISTS output_url text;
ALTER TABLE project_exports ADD COLUMN IF NOT EXISTS data jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE project_exports ADD COLUMN IF NOT EXISTS created_at text;
ALTER TABLE project_exports ADD COLUMN IF NOT EXISTS updated_at text;

CREATE INDEX IF NOT EXISTS idx_project_exports_project_updated
  ON project_exports(project_id, updated_at);

UPDATE project_assets
SET
  description = COALESCE(description, data->>'description'),
  preview_url = COALESCE(preview_url, data->>'previewUrl', data->>'preview_url'),
  media_kind = COALESCE(media_kind, data->>'mediaKind', data->>'media_kind'),
  media_url = COALESCE(media_url, data->>'mediaUrl', data->>'media_url', data->>'url'),
  source_task_id = COALESCE(source_task_id, data->>'sourceTaskId', data->>'source_task_id'),
  source_module = COALESCE(source_module, data->>'sourceModule', data->>'source_module'),
  source_metadata = CASE
    WHEN source_metadata IS NULL AND data ? 'sourceMetadata' THEN data->'sourceMetadata'
    ELSE source_metadata
  END,
  generation_prompt = COALESCE(generation_prompt, data->>'generationPrompt', data->>'generation_prompt'),
  reference_image_urls = CASE
    WHEN reference_image_urls IS NULL AND data ? 'referenceImageUrls' THEN data->'referenceImageUrls'
    ELSE reference_image_urls
  END,
  image_status = COALESCE(image_status, data->>'imageStatus', data->>'image_status'),
  image_model = COALESCE(image_model, data->>'imageModel', data->>'image_model'),
  aspect_ratio = COALESCE(aspect_ratio, data->>'aspectRatio', data->>'aspect_ratio'),
  negative_prompt = COALESCE(negative_prompt, data->>'negativePrompt', data->>'negative_prompt')
WHERE data IS NOT NULL;

DO $$
BEGIN
  IF to_regclass('public.storyboards') IS NOT NULL THEN
    EXECUTE $sql$
      INSERT INTO project_storyboards (
        id, project_id, shot_no, episode_no, title, script, image_status,
        video_status, duration_seconds, prompt_summary, image_url,
        asset_ids, data, created_at, updated_at
      )
      SELECT
        id,
        project_id,
        shot_no,
        CASE WHEN (data->>'episodeNo') ~ '^[0-9]+$' THEN (data->>'episodeNo')::integer ELSE NULL END,
        COALESCE(title, data->>'title'),
        COALESCE(data->>'script', data->>'content', ''),
        COALESCE(image_status, data->>'imageStatus', 'pending'),
        COALESCE(video_status, data->>'videoStatus', 'pending'),
        CASE WHEN (data->>'durationSeconds') ~ '^[0-9]+(\.[0-9]+)?$' THEN (data->>'durationSeconds')::numeric ELSE 0 END,
        COALESCE(data->>'promptSummary', data->>'prompt_summary', ''),
        COALESCE(data->>'imageUrl', data->>'image_url'),
        CASE WHEN data ? 'assetIds' THEN data->'assetIds' ELSE NULL END,
        COALESCE(data, '{}'::jsonb),
        created_at,
        updated_at
      FROM storyboards
      WHERE project_id IS NOT NULL
      ON CONFLICT (id) DO UPDATE SET
        project_id = EXCLUDED.project_id,
        shot_no = COALESCE(EXCLUDED.shot_no, project_storyboards.shot_no),
        episode_no = COALESCE(EXCLUDED.episode_no, project_storyboards.episode_no),
        title = COALESCE(EXCLUDED.title, project_storyboards.title),
        script = COALESCE(EXCLUDED.script, project_storyboards.script),
        image_status = COALESCE(EXCLUDED.image_status, project_storyboards.image_status),
        video_status = COALESCE(EXCLUDED.video_status, project_storyboards.video_status),
        duration_seconds = COALESCE(EXCLUDED.duration_seconds, project_storyboards.duration_seconds),
        prompt_summary = COALESCE(EXCLUDED.prompt_summary, project_storyboards.prompt_summary),
        image_url = COALESCE(EXCLUDED.image_url, project_storyboards.image_url),
        asset_ids = COALESCE(EXCLUDED.asset_ids, project_storyboards.asset_ids),
        data = project_storyboards.data || EXCLUDED.data,
        updated_at = COALESCE(EXCLUDED.updated_at, project_storyboards.updated_at)
    $sql$;
  END IF;

  IF to_regclass('public.videos') IS NOT NULL THEN
    EXECUTE $sql$
      INSERT INTO project_videos (
        id, project_id, storyboard_id, version, status, duration_seconds,
        video_url, thumbnail_url, data, created_at, updated_at
      )
      SELECT
        id,
        project_id,
        storyboard_id,
        CASE WHEN (data->>'version') ~ '^[0-9]+$' THEN (data->>'version')::integer ELSE 1 END,
        COALESCE(status, data->>'status', 'pending'),
        CASE WHEN (data->>'durationSeconds') ~ '^[0-9]+(\.[0-9]+)?$' THEN (data->>'durationSeconds')::numeric ELSE 0 END,
        COALESCE(video_url, data->>'videoUrl', data->>'video_url'),
        COALESCE(data->>'thumbnailUrl', data->>'thumbnail_url'),
        COALESCE(data, '{}'::jsonb),
        created_at,
        updated_at
      FROM videos
      WHERE project_id IS NOT NULL
      ON CONFLICT (id) DO UPDATE SET
        project_id = EXCLUDED.project_id,
        storyboard_id = COALESCE(EXCLUDED.storyboard_id, project_videos.storyboard_id),
        version = COALESCE(EXCLUDED.version, project_videos.version),
        status = COALESCE(EXCLUDED.status, project_videos.status),
        duration_seconds = COALESCE(EXCLUDED.duration_seconds, project_videos.duration_seconds),
        video_url = COALESCE(EXCLUDED.video_url, project_videos.video_url),
        thumbnail_url = COALESCE(EXCLUDED.thumbnail_url, project_videos.thumbnail_url),
        data = project_videos.data || EXCLUDED.data,
        updated_at = COALESCE(EXCLUDED.updated_at, project_videos.updated_at)
    $sql$;
  END IF;

  IF to_regclass('public.dubbings') IS NOT NULL THEN
    EXECUTE $sql$
      INSERT INTO project_dubbings (
        id, project_id, storyboard_id, speaker_name, voice_preset,
        text_content, status, audio_url, data, created_at, updated_at
      )
      SELECT
        id,
        project_id,
        storyboard_id,
        COALESCE(data->>'speakerName', data->>'speaker_name', ''),
        COALESCE(data->>'voicePreset', data->>'voice_preset', ''),
        COALESCE(data->>'text', data->>'textContent', data->>'text_content', ''),
        COALESCE(status, data->>'status', 'pending'),
        COALESCE(audio_url, data->>'audioUrl', data->>'audio_url'),
        COALESCE(data, '{}'::jsonb),
        created_at,
        updated_at
      FROM dubbings
      WHERE project_id IS NOT NULL
      ON CONFLICT (id) DO UPDATE SET
        project_id = EXCLUDED.project_id,
        storyboard_id = COALESCE(EXCLUDED.storyboard_id, project_dubbings.storyboard_id),
        speaker_name = COALESCE(EXCLUDED.speaker_name, project_dubbings.speaker_name),
        voice_preset = COALESCE(EXCLUDED.voice_preset, project_dubbings.voice_preset),
        text_content = COALESCE(EXCLUDED.text_content, project_dubbings.text_content),
        status = COALESCE(EXCLUDED.status, project_dubbings.status),
        audio_url = COALESCE(EXCLUDED.audio_url, project_dubbings.audio_url),
        data = project_dubbings.data || EXCLUDED.data,
        updated_at = COALESCE(EXCLUDED.updated_at, project_dubbings.updated_at)
    $sql$;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS canvas_projects (
  id text PRIMARY KEY,
  account_id uuid REFERENCES accounts(id),
  actor_id text,
  title text,
  thumbnail_url text,
  canvas_data jsonb,
  agent_context jsonb,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at text,
  updated_at text
);

ALTER TABLE canvas_projects ADD COLUMN IF NOT EXISTS account_id uuid REFERENCES accounts(id);
ALTER TABLE canvas_projects ADD COLUMN IF NOT EXISTS thumbnail_url text;
ALTER TABLE canvas_projects ADD COLUMN IF NOT EXISTS canvas_data jsonb;
ALTER TABLE canvas_projects ADD COLUMN IF NOT EXISTS agent_context jsonb;

CREATE INDEX IF NOT EXISTS idx_canvas_projects_account_updated
  ON canvas_projects(account_id, updated_at)
  WHERE account_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_canvas_actor
  ON canvas_projects(actor_id);

CREATE TABLE IF NOT EXISTS agent_canvas_projects (
  id text PRIMARY KEY,
  account_id uuid REFERENCES accounts(id),
  actor_id text,
  title text,
  thumbnail_url text,
  canvas_data jsonb,
  agent_context jsonb,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at text,
  updated_at text
);

ALTER TABLE agent_canvas_projects ADD COLUMN IF NOT EXISTS account_id uuid REFERENCES accounts(id);
ALTER TABLE agent_canvas_projects ADD COLUMN IF NOT EXISTS thumbnail_url text;
ALTER TABLE agent_canvas_projects ADD COLUMN IF NOT EXISTS canvas_data jsonb;
ALTER TABLE agent_canvas_projects ADD COLUMN IF NOT EXISTS agent_context jsonb;

CREATE INDEX IF NOT EXISTS idx_agent_canvas_projects_account_updated
  ON agent_canvas_projects(account_id, updated_at)
  WHERE account_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_agent_canvas_actor
  ON agent_canvas_projects(actor_id);

CREATE TABLE IF NOT EXISTS playground_conversations (
  id text PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts(id),
  actor_id text NOT NULL,
  title text NOT NULL DEFAULT '',
  model text NOT NULL DEFAULT 'qwen-plus',
  archived boolean NOT NULL DEFAULT false,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  message_count integer NOT NULL DEFAULT 0,
  last_message_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE playground_conversations ADD COLUMN IF NOT EXISTS account_id uuid REFERENCES accounts(id);
ALTER TABLE playground_conversations ADD COLUMN IF NOT EXISTS actor_id text NOT NULL DEFAULT 'guest';
ALTER TABLE playground_conversations ADD COLUMN IF NOT EXISTS title text NOT NULL DEFAULT '';
ALTER TABLE playground_conversations ADD COLUMN IF NOT EXISTS model text NOT NULL DEFAULT 'qwen-plus';
ALTER TABLE playground_conversations ADD COLUMN IF NOT EXISTS archived boolean NOT NULL DEFAULT false;
ALTER TABLE playground_conversations ADD COLUMN IF NOT EXISTS data jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE playground_conversations ADD COLUMN IF NOT EXISTS message_count integer NOT NULL DEFAULT 0;
ALTER TABLE playground_conversations ADD COLUMN IF NOT EXISTS last_message_at timestamptz;
ALTER TABLE playground_conversations ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE playground_conversations ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_playground_conversations_account_updated
  ON playground_conversations(account_id, archived, updated_at DESC, created_at DESC);

CREATE TABLE IF NOT EXISTS playground_messages (
  id text PRIMARY KEY,
  conversation_id text NOT NULL REFERENCES playground_conversations(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES accounts(id),
  actor_id text NOT NULL,
  role text NOT NULL CHECK (role IN ('system', 'user', 'assistant')),
  content text NOT NULL DEFAULT '',
  model text,
  status text NOT NULL DEFAULT 'succeeded',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE playground_messages ADD COLUMN IF NOT EXISTS conversation_id text;
ALTER TABLE playground_messages ADD COLUMN IF NOT EXISTS account_id uuid REFERENCES accounts(id);
ALTER TABLE playground_messages ADD COLUMN IF NOT EXISTS actor_id text NOT NULL DEFAULT 'guest';
ALTER TABLE playground_messages ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'assistant';
ALTER TABLE playground_messages ADD COLUMN IF NOT EXISTS content text NOT NULL DEFAULT '';
ALTER TABLE playground_messages ADD COLUMN IF NOT EXISTS model text;
ALTER TABLE playground_messages ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'succeeded';
ALTER TABLE playground_messages ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE playground_messages ADD COLUMN IF NOT EXISTS data jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE playground_messages ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE playground_messages ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_playground_messages_conversation_created
  ON playground_messages(conversation_id, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_playground_messages_account_created
  ON playground_messages(account_id, created_at DESC);

CREATE TABLE IF NOT EXISTS playground_memories (
  account_id uuid NOT NULL REFERENCES accounts(id),
  id text,
  actor_id text,
  key text NOT NULL,
  value text NOT NULL DEFAULT '',
  memory_key text,
  memory_value text,
  enabled boolean NOT NULL DEFAULT true,
  confidence numeric(6,4),
  source_conversation_id text,
  source_message_id text,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, key)
);

ALTER TABLE playground_memories ADD COLUMN IF NOT EXISTS account_id uuid REFERENCES accounts(id);
ALTER TABLE playground_memories ADD COLUMN IF NOT EXISTS id text;
ALTER TABLE playground_memories ADD COLUMN IF NOT EXISTS actor_id text;
ALTER TABLE playground_memories ADD COLUMN IF NOT EXISTS key text NOT NULL DEFAULT '';
ALTER TABLE playground_memories ADD COLUMN IF NOT EXISTS value text NOT NULL DEFAULT '';
ALTER TABLE playground_memories ADD COLUMN IF NOT EXISTS memory_key text;
ALTER TABLE playground_memories ADD COLUMN IF NOT EXISTS memory_value text;
ALTER TABLE playground_memories ADD COLUMN IF NOT EXISTS enabled boolean NOT NULL DEFAULT true;
ALTER TABLE playground_memories ADD COLUMN IF NOT EXISTS confidence numeric(6,4);
ALTER TABLE playground_memories ADD COLUMN IF NOT EXISTS source_conversation_id text;
ALTER TABLE playground_memories ADD COLUMN IF NOT EXISTS source_message_id text;
ALTER TABLE playground_memories ADD COLUMN IF NOT EXISTS data jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE playground_memories ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE playground_memories ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE UNIQUE INDEX IF NOT EXISTS uq_playground_memories_account_key
  ON playground_memories(account_id, key);

CREATE INDEX IF NOT EXISTS idx_playground_memories_account_updated
  ON playground_memories(account_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS playground_memory_preferences (
  account_id uuid PRIMARY KEY REFERENCES accounts(id),
  actor_id text NOT NULL DEFAULT 'guest',
  enabled boolean NOT NULL DEFAULT true,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz
);

ALTER TABLE playground_memory_preferences ADD COLUMN IF NOT EXISTS account_id uuid REFERENCES accounts(id);
ALTER TABLE playground_memory_preferences ADD COLUMN IF NOT EXISTS actor_id text NOT NULL DEFAULT 'guest';
ALTER TABLE playground_memory_preferences ADD COLUMN IF NOT EXISTS enabled boolean NOT NULL DEFAULT true;
ALTER TABLE playground_memory_preferences ADD COLUMN IF NOT EXISTS data jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE playground_memory_preferences ADD COLUMN IF NOT EXISTS updated_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS uq_playground_memory_preferences_account
  ON playground_memory_preferences(account_id);

CREATE TABLE IF NOT EXISTS create_studio_result_deletions (
  account_id uuid NOT NULL REFERENCES accounts(id),
  result_kind text NOT NULL CHECK (result_kind IN ('image', 'video')),
  result_id text NOT NULL,
  deleted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, result_kind, result_id)
);

CREATE OR REPLACE FUNCTION xiaolou_lock_account_lane(
  p_account_id uuid,
  p_lane text
) RETURNS void
LANGUAGE sql
AS $$
  SELECT pg_advisory_xact_lock(
    ('x' || substr(md5(p_account_id::text || ':' || p_lane), 1, 16))::bit(64)::bigint
  );
$$;

CREATE OR REPLACE FUNCTION xiaolou_try_lock_account_lane(
  p_account_id uuid,
  p_lane text
) RETURNS boolean
LANGUAGE sql
AS $$
  SELECT pg_try_advisory_xact_lock(
    ('x' || substr(md5(p_account_id::text || ':' || p_lane), 1, 16))::bit(64)::bigint
  );
$$;

CREATE OR REPLACE FUNCTION notify_job_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM pg_notify(
    'xiaolou_jobs',
    json_build_object(
      'job_id', NEW.id,
      'account_id', NEW.account_id,
      'lane', NEW.lane,
      'status', NEW.status
    )::text
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_job_change ON jobs;

CREATE TRIGGER trg_notify_job_change
AFTER INSERT OR UPDATE OF status, run_after
ON jobs
FOR EACH ROW
EXECUTE FUNCTION notify_job_change();
