"""merge public legacy tables into uuid schema

Revision ID: 20260501_0002
Revises: 20260501_0001
Create Date: 2026-05-01 12:00:00+00:00
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa

from app.models import Base

revision = "20260501_0002"
down_revision = "20260501_0001"
branch_labels = None
depends_on = None

BACKUP_SCHEMA = "backup_before_uuid_merge_20260501"

LEGACY_TABLES = [
    "users",
    "organizations",
    "organization_members",
    "wallets",
    "wallet_ledger",
    "wallet_recharge_orders",
    "projects",
    "tasks",
    "project_settings",
    "project_scripts",
    "project_assets",
    "storyboards",
    "videos",
    "dubbings",
    "project_timelines",
    "canvas_projects",
    "agent_canvas_projects",
    "create_studio_images",
    "create_studio_videos",
    "video_replace_jobs",
]

ID_COLUMNS = [
    ("users", "id", "user"),
    ("organizations", "id", "organization"),
    ("organization_members", "id", "organization_member"),
    ("wallets", "id", "wallet"),
    ("wallet_ledger", "id", "wallet_ledger"),
    ("wallet_recharge_orders", "id", "wallet_recharge_order"),
    ("projects", "id", "project"),
    ("tasks", "id", "task"),
    ("project_scripts", "id", "project_script"),
    ("project_assets", "id", "asset"),
    ("storyboards", "id", "storyboard"),
    ("videos", "id", "video"),
    ("dubbings", "id", "dubbing"),
    ("canvas_projects", "id", "canvas"),
    ("agent_canvas_projects", "id", "agent_canvas"),
    ("create_studio_images", "id", "create_image"),
    ("create_studio_videos", "id", "create_video"),
    ("video_replace_jobs", "job_id", "video_replace_job"),
]

REF_COLUMNS = [
    ("users", "organization_id", "organization"),
    ("organization_members", "organization_id", "organization"),
    ("organization_members", "user_id", "user"),
    ("wallet_ledger", "wallet_id", "wallet"),
    ("wallet_ledger", "actor_id", "user"),
    ("wallet_recharge_orders", "actor_id", "user"),
    ("wallet_recharge_orders", "wallet_id", "wallet"),
    ("projects", "organization_id", "organization"),
    ("tasks", "project_id", "project"),
    ("tasks", "actor_id", "user"),
    ("tasks", "wallet_id", "wallet"),
    ("project_settings", "project_id", "project"),
    ("project_scripts", "project_id", "project"),
    ("project_assets", "project_id", "project"),
    ("storyboards", "project_id", "project"),
    ("videos", "project_id", "project"),
    ("videos", "storyboard_id", "storyboard"),
    ("dubbings", "project_id", "project"),
    ("dubbings", "storyboard_id", "storyboard"),
    ("project_timelines", "project_id", "project"),
    ("canvas_projects", "actor_id", "user"),
    ("agent_canvas_projects", "actor_id", "user"),
    ("create_studio_images", "actor_id", "user"),
    ("create_studio_images", "task_id", "task"),
    ("create_studio_videos", "actor_id", "user"),
    ("create_studio_videos", "task_id", "task"),
    ("video_replace_jobs", "task_id", "task"),
]

TIMESTAMP_TABLES = [
    "users",
    "organizations",
    "organization_members",
    "wallets",
    "wallet_ledger",
    "wallet_recharge_orders",
    "projects",
    "tasks",
    "project_scripts",
    "project_assets",
    "storyboards",
    "videos",
    "dubbings",
    "canvas_projects",
    "agent_canvas_projects",
    "create_studio_images",
    "create_studio_videos",
    "video_replace_jobs",
]


def _scalar(conn: sa.Connection, sql: str, **params: object) -> object:
    return conn.execute(sa.text(sql), params).scalar()


def _exec(conn: sa.Connection, sql: str, **params: object) -> None:
    conn.execute(sa.text(sql), params)


def _table_exists(conn: sa.Connection, table: str) -> bool:
    return _scalar(conn, "select to_regclass(:name)", name=f"public.{table}") is not None


def _column_type(conn: sa.Connection, table: str, column: str) -> str | None:
    value = _scalar(
        conn,
        """
        select udt_name
        from information_schema.columns
        where table_schema='public' and table_name=:table and column_name=:column
        """,
        table=table,
        column=column,
    )
    return str(value) if value else None


def _column_exists(conn: sa.Connection, table: str, column: str) -> bool:
    return _column_type(conn, table, column) is not None


def _add_column(conn: sa.Connection, table: str, ddl: str) -> None:
    if _table_exists(conn, table):
        _exec(conn, f"alter table public.{table} add column if not exists {ddl}")


def _coalesce_existing(
    conn: sa.Connection,
    table: str,
    candidates: list[tuple[str, str]],
    fallback: str,
) -> str:
    parts = [expr for column, expr in candidates if _column_exists(conn, table, column)]
    parts.append(fallback)
    return f"coalesce({', '.join(parts)})"


def _convert_text_column_to_uuid(
    conn: sa.Connection,
    *,
    table: str,
    column: str,
    entity: str,
) -> None:
    if not _table_exists(conn, table) or not _column_exists(conn, table, column):
        return
    if _column_type(conn, table, column) == "uuid":
        return

    entity_literal = entity.replace("'", "''")
    legacy_column = "legacy_id" if column in {"id", "job_id"} else f"legacy_{column}"
    _add_column(conn, table, f"{legacy_column} text")
    _exec(
        conn,
        f"""
        update public.{table}
        set {legacy_column} = {column}
        where {legacy_column} is null and {column} is not null
        """,
    )
    _exec(
        conn,
        f"""
        insert into public.legacy_id_map(entity, legacy_id, uuid_id)
        select :entity, {legacy_column}, public.xiaolou_legacy_uuid(:entity, {legacy_column})
        from public.{table}
        where {legacy_column} is not null and btrim({legacy_column}) <> ''
        on conflict (entity, legacy_id) do nothing
        """,
        entity=entity,
    )
    _exec(
        conn,
        f"""
        alter table public.{table}
        alter column {column} type uuid
        using public.xiaolou_legacy_uuid('{entity_literal}', {column})
        """,
    )


def _convert_owner_id(conn: sa.Connection, table: str) -> None:
    if not _table_exists(conn, table) or not _column_exists(conn, table, "owner_id"):
        return
    if _column_type(conn, table, "owner_id") == "uuid":
        return

    _add_column(conn, table, "legacy_owner_id text")
    _exec(
        conn,
        f"""
        update public.{table}
        set legacy_owner_id = owner_id
        where legacy_owner_id is null and owner_id is not null
        """,
    )
    _exec(
        conn,
        f"""
        insert into public.legacy_id_map(entity, legacy_id, uuid_id)
        select
          case
            when lower(coalesce(owner_type, '')) in ('organization', 'org', 'enterprise')
              then 'organization'
            else 'user'
          end,
          legacy_owner_id,
          public.xiaolou_legacy_uuid(
            case
              when lower(coalesce(owner_type, '')) in ('organization', 'org', 'enterprise')
                then 'organization'
              else 'user'
            end,
            legacy_owner_id
          )
        from public.{table}
        where legacy_owner_id is not null and btrim(legacy_owner_id) <> ''
        on conflict (entity, legacy_id) do nothing
        """,
    )
    _exec(
        conn,
        f"""
        alter table public.{table}
        alter column owner_id type uuid
        using case
          when owner_id is null or btrim(owner_id) = '' then null
          when lower(coalesce(owner_type, '')) in ('organization', 'org', 'enterprise')
            then public.xiaolou_legacy_uuid('organization', owner_id)
          else public.xiaolou_legacy_uuid('user', owner_id)
        end
        """,
    )


def _convert_timestamp(conn: sa.Connection, table: str, column: str) -> None:
    if not _table_exists(conn, table) or not _column_exists(conn, table, column):
        return
    if _column_type(conn, table, column) == "timestamptz":
        return
    _exec(
        conn,
        f"""
        alter table public.{table}
        alter column {column} type timestamptz
        using public.xiaolou_parse_timestamptz({column})
        """,
    )


def _prepare_helpers(conn: sa.Connection) -> None:
    _exec(
        conn,
        """
        create or replace function public.xiaolou_legacy_uuid(entity text, legacy text)
        returns uuid
        language sql
        immutable
        as $$
          select case
            when legacy is null or btrim(legacy) = '' then null
            when legacy ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              then legacy::uuid
            else (
              substr(md5('xiaolou:' || entity || ':' || legacy), 1, 8) || '-' ||
              substr(md5('xiaolou:' || entity || ':' || legacy), 9, 4) || '-' ||
              substr(md5('xiaolou:' || entity || ':' || legacy), 13, 4) || '-' ||
              substr(md5('xiaolou:' || entity || ':' || legacy), 17, 4) || '-' ||
              substr(md5('xiaolou:' || entity || ':' || legacy), 21, 12)
            )::uuid
          end
        $$;
        """,
    )
    _exec(
        conn,
        """
        create or replace function public.xiaolou_parse_timestamptz(value text)
        returns timestamptz
        language plpgsql
        stable
        as $$
        begin
          if value is null or btrim(value) = '' then
            return null;
          end if;
          return value::timestamptz;
        exception when others then
          return null;
        end;
        $$;
        """,
    )
    _exec(
        conn,
        """
        create table if not exists public.legacy_id_map (
          entity text not null,
          legacy_id text not null,
          uuid_id uuid not null,
          created_at timestamptz not null default now(),
          primary key (entity, legacy_id),
          unique (uuid_id)
        )
        """,
    )


def _backup_public_tables(conn: sa.Connection) -> None:
    _exec(conn, f'create schema if not exists "{BACKUP_SCHEMA}"')
    for table in LEGACY_TABLES:
        if not _table_exists(conn, table):
            continue
        backup_exists = _scalar(
            conn,
            "select to_regclass(:name)",
            name=f"{BACKUP_SCHEMA}.{table}",
        )
        if backup_exists is None:
            _exec(
                conn,
                f'create table "{BACKUP_SCHEMA}".{table} as table public.{table} with data',
            )


def _add_python_columns(conn: sa.Connection) -> None:
    _add_column(conn, "users", "status text")
    _exec(
        conn,
        """
        update public.users
        set status = coalesce(status, data->>'status', 'active')
        where status is null
        """,
    )

    _add_column(conn, "tasks", "queue_name text default 'default'")
    _add_column(conn, "tasks", "progress integer default 0")
    _add_column(conn, "tasks", "error text")
    _exec(
        conn,
        """
        update public.tasks
        set
          queue_name = coalesce(queue_name, 'default'),
          progress = coalesce(progress, 0),
          error = coalesce(error, data->>'error')
        """,
    )

    _add_column(conn, "wallets", "balance_cents bigint default 0")
    _add_column(conn, "wallets", "credit_balance numeric(18,4) default 0")
    _add_column(conn, "wallets", "currency varchar(8) default 'CNY'")
    wallet_credit_expr = _coalesce_existing(
        conn,
        "wallets",
        [
            ("credit_balance", "credit_balance"),
            ("available_credits", "available_credits"),
            ("balance", "balance"),
        ],
        "0",
    )
    wallet_currency_expr = _coalesce_existing(
        conn,
        "wallets",
        [
            ("currency", "currency"),
            ("data", "nullif(data->>'currency', '')"),
        ],
        "'CNY'",
    )
    _exec(
        conn,
        f"""
        update public.wallets
        set
          balance_cents = coalesce(balance_cents, 0),
          credit_balance = {wallet_credit_expr},
          currency = {wallet_currency_expr}
        """,
    )

    _add_column(conn, "wallet_ledger", "amount_cents bigint default 0")
    _add_column(conn, "wallet_ledger", "credit_amount numeric(18,4) default 0")
    ledger_credit_expr = _coalesce_existing(
        conn,
        "wallet_ledger",
        [
            ("credit_amount", "credit_amount"),
            ("amount", "amount"),
        ],
        "0",
    )
    _exec(
        conn,
        f"""
        update public.wallet_ledger
        set
          amount_cents = coalesce(amount_cents, 0),
          credit_amount = {ledger_credit_expr}
        """,
    )

    _add_column(conn, "wallet_recharge_orders", "provider varchar(40)")
    _add_column(conn, "wallet_recharge_orders", "idempotency_key varchar(160)")
    _add_column(conn, "wallet_recharge_orders", "amount_cents bigint")
    _add_column(conn, "wallet_recharge_orders", "credit_amount numeric(18,4) default 0")
    _add_column(conn, "wallet_recharge_orders", "currency varchar(8) default 'CNY'")
    _add_column(conn, "wallet_recharge_orders", "paid_at timestamptz")
    recharge_provider_expr = _coalesce_existing(
        conn,
        "wallet_recharge_orders",
        [
            ("provider", "provider"),
            ("payment_method", "payment_method"),
            ("data", "data->>'provider'"),
        ],
        "'legacy'",
    )
    recharge_amount_expr = _coalesce_existing(
        conn,
        "wallet_recharge_orders",
        [
            ("amount_cents", "amount_cents"),
            ("amount", "round(coalesce(amount, 0) * 100)::bigint"),
        ],
        "0",
    )
    recharge_credit_expr = _coalesce_existing(
        conn,
        "wallet_recharge_orders",
        [
            ("credit_amount", "credit_amount"),
            ("credits", "credits"),
        ],
        "0",
    )
    recharge_currency_expr = _coalesce_existing(
        conn,
        "wallet_recharge_orders",
        [
            ("currency", "currency"),
            ("data", "data->>'currency'"),
        ],
        "'CNY'",
    )
    paid_at_expr = (
        "coalesce(paid_at, public.xiaolou_parse_timestamptz(data->>'paidAt'))"
        if _column_exists(conn, "wallet_recharge_orders", "data")
        else "paid_at"
    )
    _exec(
        conn,
        f"""
        update public.wallet_recharge_orders
        set
          provider = {recharge_provider_expr},
          idempotency_key = coalesce(idempotency_key, 'legacy:' || id::text),
          amount_cents = {recharge_amount_expr},
          credit_amount = {recharge_credit_expr},
          currency = {recharge_currency_expr},
          paid_at = {paid_at_expr}
        """,
    )

    _add_column(conn, "video_replace_jobs", "task_id uuid")
    _add_column(conn, "video_replace_jobs", "queue_name varchar(80) default 'video_local_gpu'")
    _add_column(conn, "video_replace_jobs", "provider_job_id uuid")


def _create_indexes(conn: sa.Connection) -> None:
    statements = [
        """
        create unique index if not exists uq_wallet_owner
        on public.wallets(owner_type, owner_id)
        where owner_type is not null and owner_id is not null
        """,
        """
        create unique index if not exists uq_wallet_ledger_recharge_source
        on public.wallet_ledger(wallet_id, source_type, source_id)
        where source_type = 'wallet_recharge_order'
        """,
        """
        create unique index if not exists uq_wallet_recharge_idempotency_key
        on public.wallet_recharge_orders(idempotency_key)
        where idempotency_key is not null
        """,
        """
        create unique index if not exists uq_wallet_recharge_provider_trade
        on public.wallet_recharge_orders(provider, provider_trade_no)
        where provider_trade_no is not null
        """,
        """
        create unique index if not exists uq_idempotency_scope_key
        on public.idempotency_keys(scope, key)
        """,
        """
        create unique index if not exists uq_payment_events_provider_event
        on public.payment_events(provider, event_id)
        """,
    ]
    for statement in statements:
        _exec(conn, statement)


def _copy_project_assets_to_assets(conn: sa.Connection) -> None:
    if not _table_exists(conn, "project_assets") or not _table_exists(conn, "assets"):
        return
    _exec(
        conn,
        """
        insert into public.assets
          (id, project_id, owner_id, asset_type, storage_url, checksum, payload, created_at, updated_at)
        select
          pa.id,
          pa.project_id,
          null,
          coalesce(pa.asset_type, pa.data->>'assetType', pa.data->>'type', 'legacy'),
          coalesce(
            pa.data->>'storageUrl',
            pa.data->>'url',
            pa.data->>'imageUrl',
            pa.data->>'fileUrl',
            pa.name,
            ''
          ),
          pa.data->>'checksum',
          pa.data,
          coalesce(pa.created_at, pa.updated_at, now()),
          coalesce(pa.updated_at, pa.created_at, now())
        from public.project_assets pa
        on conflict (id) do nothing
        """,
    )


def upgrade() -> None:
    conn = op.get_bind()
    _prepare_helpers(conn)
    _backup_public_tables(conn)

    for table, column, entity in ID_COLUMNS:
        _convert_text_column_to_uuid(conn, table=table, column=column, entity=entity)

    for table in ("projects", "wallets"):
        _convert_owner_id(conn, table)

    for table, column, entity in REF_COLUMNS:
        _convert_text_column_to_uuid(conn, table=table, column=column, entity=entity)

    for table in TIMESTAMP_TABLES:
        _convert_timestamp(conn, table, "created_at")
        _convert_timestamp(conn, table, "updated_at")

    _add_python_columns(conn)
    Base.metadata.create_all(bind=conn, checkfirst=True)
    _copy_project_assets_to_assets(conn)
    _create_indexes(conn)


def downgrade() -> None:
    # The migration stores a full data copy under BACKUP_SCHEMA before changing
    # public tables. Restoring it is intentionally manual so a downgrade cannot
    # silently discard writes made after the merge.
    raise NotImplementedError(
        f"Manual restore required from schema {BACKUP_SCHEMA}; "
        "do not auto-downgrade a merged production database."
    )
