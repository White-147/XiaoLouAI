import os
import uuid
from datetime import datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import (
    BigInteger,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    func,
    MetaData,
    text as sql_text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

DATABASE_SCHEMA = os.getenv("DATABASE_SCHEMA", "").strip() or None


def schema_fk(target: str) -> str:
    return f"{DATABASE_SCHEMA}.{target}" if DATABASE_SCHEMA else target


class Base(DeclarativeBase):
    metadata = MetaData(schema=DATABASE_SCHEMA)
    type_annotation_map = {dict[str, Any]: JSONB}


def new_uuid() -> uuid.UUID:
    return uuid.uuid4()


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class User(Base, TimestampMixin):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=new_uuid)
    legacy_id: Mapped[str | None] = mapped_column(String(180))
    email: Mapped[str | None] = mapped_column(String(320), unique=True)
    display_name: Mapped[str] = mapped_column(String(120), default="")
    role: Mapped[str] = mapped_column("platform_role", String(40), default="customer", index=True)
    status: Mapped[str] = mapped_column(String(40), default="active", index=True)
    payload: Mapped[dict[str, Any]] = mapped_column("data", JSONB, default=dict)


class Project(Base, TimestampMixin):
    __tablename__ = "projects"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=new_uuid)
    legacy_id: Mapped[str | None] = mapped_column(String(180))
    owner_type: Mapped[str | None] = mapped_column(String(40))
    owner_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    organization_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    title: Mapped[str] = mapped_column(String(240))
    status: Mapped[str] = mapped_column(String(40), default="active", index=True)
    payload: Mapped[dict[str, Any]] = mapped_column("data", JSONB, default=dict)


class Asset(Base, TimestampMixin):
    __tablename__ = "assets"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=new_uuid)
    project_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey(schema_fk("projects.id"))
    )
    owner_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey(schema_fk("users.id"))
    )
    asset_type: Mapped[str] = mapped_column(String(40), index=True)
    storage_url: Mapped[str] = mapped_column(Text)
    checksum: Mapped[str | None] = mapped_column(String(128), index=True)
    payload: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)


class Task(Base, TimestampMixin):
    __tablename__ = "tasks"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=new_uuid)
    legacy_id: Mapped[str | None] = mapped_column(String(180))
    project_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey(schema_fk("projects.id"))
    )
    actor_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey(schema_fk("users.id"))
    )
    task_type: Mapped[str] = mapped_column("type", String(80), index=True)
    action_code: Mapped[str | None] = mapped_column(String(120))
    queue_name: Mapped[str] = mapped_column(String(80), default="default", index=True)
    status: Mapped[str] = mapped_column(String(40), default="queued", index=True)
    progress: Mapped[Decimal] = mapped_column(Numeric(10, 4), default=0)
    error: Mapped[str | None] = mapped_column(Text)
    wallet_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey(schema_fk("wallets.id"))
    )
    payload: Mapped[dict[str, Any]] = mapped_column("data", JSONB, default=dict)

    __table_args__ = (Index("ix_tasks_project_status", "project_id", "status"),)


class Wallet(Base, TimestampMixin):
    __tablename__ = "wallets"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=new_uuid)
    legacy_id: Mapped[str | None] = mapped_column(String(180))
    owner_type: Mapped[str] = mapped_column(String(40), index=True)
    owner_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), index=True)
    balance_cents: Mapped[int] = mapped_column(BigInteger, default=0)
    credit_balance: Mapped[Decimal] = mapped_column(Numeric(18, 4), default=0)
    currency: Mapped[str] = mapped_column(String(8), default="CNY")
    payload: Mapped[dict[str, Any]] = mapped_column("data", JSONB, default=dict)

    __table_args__ = (UniqueConstraint("owner_type", "owner_id", name="uq_wallet_owner"),)


class WalletLedger(Base, TimestampMixin):
    __tablename__ = "wallet_ledger"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=new_uuid)
    wallet_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey(schema_fk("wallets.id")), index=True
    )
    entry_type: Mapped[str] = mapped_column(String(40), index=True)
    amount_cents: Mapped[int] = mapped_column(BigInteger, default=0)
    credit_amount: Mapped[Decimal] = mapped_column(Numeric(18, 4), default=0)
    source_type: Mapped[str] = mapped_column(String(80))
    source_id: Mapped[str] = mapped_column(String(120), index=True)
    payload: Mapped[dict[str, Any]] = mapped_column("data", JSONB, default=dict)

    __table_args__ = (
        Index(
            "uq_wallet_ledger_recharge_source",
            "wallet_id",
            "source_type",
            "source_id",
            unique=True,
            postgresql_where=sql_text("source_type = 'wallet_recharge_order'"),
        ),
    )


class WalletRechargeOrder(Base, TimestampMixin):
    __tablename__ = "wallet_recharge_orders"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=new_uuid)
    legacy_id: Mapped[str | None] = mapped_column(String(180))
    wallet_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey(schema_fk("wallets.id")), index=True
    )
    provider: Mapped[str] = mapped_column(String(40), index=True)
    provider_trade_no: Mapped[str | None] = mapped_column(String(128))
    idempotency_key: Mapped[str] = mapped_column(String(160))
    status: Mapped[str] = mapped_column(String(40), default="created", index=True)
    amount_cents: Mapped[int] = mapped_column(BigInteger)
    credit_amount: Mapped[Decimal] = mapped_column(Numeric(18, 4), default=0)
    currency: Mapped[str] = mapped_column(String(8), default="CNY")
    paid_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    payment_method: Mapped[str | None] = mapped_column(String(40))
    mode: Mapped[str | None] = mapped_column(String(40))
    payload: Mapped[dict[str, Any]] = mapped_column("data", JSONB, default=dict)

    __table_args__ = (
        UniqueConstraint("idempotency_key", name="uq_wallet_recharge_idempotency_key"),
        UniqueConstraint("provider", "provider_trade_no", name="uq_wallet_recharge_provider_trade"),
    )


class PaymentEvent(Base, TimestampMixin):
    __tablename__ = "payment_events"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=new_uuid)
    provider: Mapped[str] = mapped_column(String(40), index=True)
    event_id: Mapped[str] = mapped_column(String(160))
    provider_trade_no: Mapped[str | None] = mapped_column(String(128), index=True)
    event_type: Mapped[str] = mapped_column(String(80), index=True)
    verified: Mapped[bool] = mapped_column(default=False)
    payload: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)

    __table_args__ = (UniqueConstraint("provider", "event_id", name="uq_payment_events_provider_event"),)


class IdempotencyKey(Base, TimestampMixin):
    __tablename__ = "idempotency_keys"

    id: Mapped[uuid.UUID] = mapped_column("job_id", UUID(as_uuid=True), primary_key=True, default=new_uuid)
    scope: Mapped[str] = mapped_column(String(80), default="global")
    key: Mapped[str] = mapped_column(String(180))
    request_hash: Mapped[str] = mapped_column(String(128))
    response_payload: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    status_code: Mapped[int | None] = mapped_column(Integer)

    __table_args__ = (UniqueConstraint("scope", "key", name="uq_idempotency_scope_key"),)


class VideoReplaceJob(Base, TimestampMixin):
    __tablename__ = "video_replace_jobs"

    id: Mapped[uuid.UUID] = mapped_column(
        "job_id", UUID(as_uuid=True), primary_key=True, default=new_uuid
    )
    legacy_id: Mapped[str | None] = mapped_column(Text)
    task_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey(schema_fk("tasks.id")), index=True
    )
    status: Mapped[str] = mapped_column("stage", Text, default="queued", index=True)
    progress: Mapped[Decimal] = mapped_column(Numeric(10, 4), default=Decimal("0"))
    queue_name: Mapped[str] = mapped_column(String(80), default="video_local_gpu", index=True)
    provider_job_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey(schema_fk("provider_jobs.id"))
    )
    message: Mapped[str | None] = mapped_column(Text)
    error: Mapped[str | None] = mapped_column(Text)
    payload: Mapped[dict[str, Any]] = mapped_column("data", JSONB, default=dict)


class ProviderJob(Base, TimestampMixin):
    __tablename__ = "provider_jobs"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=new_uuid)
    task_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey(schema_fk("tasks.id")), index=True
    )
    provider: Mapped[str] = mapped_column(String(80), index=True)
    model_id: Mapped[str] = mapped_column(String(180), index=True)
    external_job_id: Mapped[str | None] = mapped_column(String(180))
    status: Mapped[str] = mapped_column(String(40), default="queued", index=True)
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    timeout_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    payload: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)

    __table_args__ = (UniqueConstraint("provider", "external_job_id", name="uq_provider_jobs_external"),)


class OutboxEvent(Base, TimestampMixin):
    __tablename__ = "outbox_events"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=new_uuid)
    aggregate_type: Mapped[str] = mapped_column(String(80), index=True)
    aggregate_id: Mapped[str] = mapped_column(String(160), index=True)
    event_type: Mapped[str] = mapped_column(String(80), index=True)
    status: Mapped[str] = mapped_column(String(40), default="pending", index=True)
    payload: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)


class AuditLog(Base, TimestampMixin):
    __tablename__ = "audit_logs"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=new_uuid)
    actor_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), index=True)
    action: Mapped[str] = mapped_column(String(120), index=True)
    resource_type: Mapped[str] = mapped_column(String(80), index=True)
    resource_id: Mapped[str | None] = mapped_column(String(160), index=True)
    payload: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
