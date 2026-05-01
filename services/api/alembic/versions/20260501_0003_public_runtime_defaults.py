"""add runtime defaults after public uuid merge

Revision ID: 20260501_0003
Revises: 20260501_0002
Create Date: 2026-05-01 13:00:00+00:00
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "20260501_0003"
down_revision = "20260501_0002"
branch_labels = None
depends_on = None

JSONB_DEFAULTS = [
    ("users", "data"),
    ("projects", "data"),
    ("tasks", "data"),
    ("wallets", "data"),
    ("wallet_ledger", "data"),
    ("wallet_recharge_orders", "data"),
    ("video_replace_jobs", "data"),
    ("assets", "payload"),
    ("payment_events", "payload"),
    ("idempotency_keys", "response_payload"),
    ("provider_jobs", "payload"),
    ("outbox_events", "payload"),
    ("audit_logs", "payload"),
]

TIMESTAMP_DEFAULTS = [
    "users",
    "projects",
    "tasks",
    "wallets",
    "wallet_ledger",
    "wallet_recharge_orders",
    "video_replace_jobs",
    "assets",
    "payment_events",
    "idempotency_keys",
    "provider_jobs",
    "outbox_events",
    "audit_logs",
]

COLUMN_DEFAULTS = [
    ("users", "status", "'active'"),
    ("tasks", "queue_name", "'default'"),
    ("tasks", "progress", "0"),
    ("wallets", "balance_cents", "0"),
    ("wallets", "credit_balance", "0"),
    ("wallets", "currency", "'CNY'"),
    ("wallet_ledger", "amount_cents", "0"),
    ("wallet_ledger", "credit_amount", "0"),
    ("wallet_recharge_orders", "credit_amount", "0"),
    ("wallet_recharge_orders", "currency", "'CNY'"),
    ("video_replace_jobs", "queue_name", "'video_local_gpu'"),
    ("video_replace_jobs", "progress", "0"),
]


def _scalar(conn: sa.Connection, sql: str, **params: object) -> object:
    return conn.execute(sa.text(sql), params).scalar()


def _exec(conn: sa.Connection, sql: str, **params: object) -> None:
    conn.execute(sa.text(sql), params)


def _table_exists(conn: sa.Connection, table: str) -> bool:
    return _scalar(conn, "select to_regclass(:name)", name=f"public.{table}") is not None


def _column_exists(conn: sa.Connection, table: str, column: str) -> bool:
    value = _scalar(
        conn,
        """
        select 1
        from information_schema.columns
        where table_schema='public' and table_name=:table and column_name=:column
        """,
        table=table,
        column=column,
    )
    return value is not None


def _set_default(conn: sa.Connection, table: str, column: str, default_sql: str) -> None:
    if _table_exists(conn, table) and _column_exists(conn, table, column):
        _exec(conn, f"alter table public.{table} alter column {column} set default {default_sql}")


def _drop_default(conn: sa.Connection, table: str, column: str) -> None:
    if _table_exists(conn, table) and _column_exists(conn, table, column):
        _exec(conn, f"alter table public.{table} alter column {column} drop default")


def _coalesce_existing(
    conn: sa.Connection,
    table: str,
    candidates: list[tuple[str, str]],
    fallback: str,
) -> str:
    parts = [expr for column, expr in candidates if _column_exists(conn, table, column)]
    parts.append(fallback)
    return f"coalesce({', '.join(parts)})"


def _backfill_jsonb(conn: sa.Connection, table: str, column: str) -> None:
    if _table_exists(conn, table) and _column_exists(conn, table, column):
        _exec(conn, f"update public.{table} set {column} = '{{}}'::jsonb where {column} is null")


def _backfill_timestamps(conn: sa.Connection, table: str) -> None:
    if not _table_exists(conn, table):
        return
    has_created = _column_exists(conn, table, "created_at")
    has_updated = _column_exists(conn, table, "updated_at")
    if has_created:
        _exec(conn, f"alter table public.{table} alter column created_at set default now()")
    if has_updated:
        _exec(conn, f"alter table public.{table} alter column updated_at set default now()")
    if has_created and has_updated:
        _exec(
            conn,
            f"""
            update public.{table}
            set
              created_at = coalesce(created_at, updated_at, now()),
              updated_at = coalesce(updated_at, created_at, now())
            where created_at is null or updated_at is null
            """,
        )
    elif has_created:
        _exec(conn, f"update public.{table} set created_at = now() where created_at is null")
    elif has_updated:
        _exec(conn, f"update public.{table} set updated_at = now() where updated_at is null")


def upgrade() -> None:
    conn = op.get_bind()

    for table, column in JSONB_DEFAULTS:
        _backfill_jsonb(conn, table, column)
        _set_default(conn, table, column, "'{}'::jsonb")

    for table in TIMESTAMP_DEFAULTS:
        _backfill_timestamps(conn, table)

    for table, column, default_sql in COLUMN_DEFAULTS:
        _set_default(conn, table, column, default_sql)

    if _table_exists(conn, "wallets"):
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
              currency = {wallet_currency_expr},
              data = coalesce(data, '{{}}'::jsonb)
            where
              balance_cents is null
              or credit_balance is null
              or currency is null
              or data is null
            """,
        )

    if _table_exists(conn, "wallet_ledger"):
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
              credit_amount = {ledger_credit_expr},
              data = coalesce(data, '{{}}'::jsonb)
            where amount_cents is null or credit_amount is null or data is null
            """,
        )

    if _table_exists(conn, "wallet_recharge_orders"):
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
              data = coalesce(data, '{{}}'::jsonb)
            where
              provider is null
              or idempotency_key is null
              or amount_cents is null
              or credit_amount is null
              or currency is null
              or data is null
            """,
        )


def downgrade() -> None:
    conn = op.get_bind()
    for table, column in JSONB_DEFAULTS:
        _drop_default(conn, table, column)
    for table in TIMESTAMP_DEFAULTS:
        _drop_default(conn, table, "created_at")
        _drop_default(conn, table, "updated_at")
    for table, column, _default_sql in COLUMN_DEFAULTS:
        _drop_default(conn, table, column)
