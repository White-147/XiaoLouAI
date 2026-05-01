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

CREATE INDEX IF NOT EXISTS ix_jobs_lease_timeout
  ON jobs(status, lease_until)
  WHERE status IN ('leased', 'running');

CREATE INDEX IF NOT EXISTS ix_jobs_account_status
  ON jobs(account_id, status, created_at DESC);

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
