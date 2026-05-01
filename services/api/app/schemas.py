from datetime import datetime
from decimal import Decimal
from typing import Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator


class HealthResponse(BaseModel):
    status: str
    database: dict[str, Any] | None = None


class ProjectCreate(BaseModel):
    title: str = Field(min_length=1, max_length=240)
    owner_id: UUID | None = None
    payload: dict[str, Any] = Field(default_factory=dict)


class ProjectRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    owner_id: UUID | None
    title: str
    status: str
    payload: dict[str, Any]
    created_at: datetime
    updated_at: datetime


class TaskCreate(BaseModel):
    task_type: str = Field(min_length=1, max_length=80)
    queue_name: str = Field(default="default", max_length=80)
    project_id: UUID | None = None
    actor_id: UUID | None = None
    payload: dict[str, Any] = Field(default_factory=dict)


class TaskRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    project_id: UUID | None
    actor_id: UUID | None
    task_type: str
    queue_name: str
    status: str
    progress: int
    error: str | None
    payload: dict[str, Any]
    created_at: datetime
    updated_at: datetime


class UploadSignRequest(BaseModel):
    filename: str = Field(min_length=1, max_length=255)
    content_type: str = Field(default="application/octet-stream", max_length=120)
    asset_type: str = Field(default="generic", max_length=40)


class UploadSignResponse(BaseModel):
    upload_url: str
    public_url: str
    method: str = "PUT"
    headers: dict[str, str] = Field(default_factory=dict)


class WalletRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    owner_type: str
    owner_id: UUID
    balance_cents: int
    credit_balance: Decimal
    currency: str
    created_at: datetime
    updated_at: datetime


class WalletRechargeCreate(BaseModel):
    owner_id: UUID
    owner_type: str = Field(default="user", max_length=40)
    provider: str = Field(default="alipay", max_length=40)
    amount_cents: int = Field(gt=0)
    credit_amount: Decimal = Field(default=Decimal("0"), ge=0)
    currency: str = Field(default="CNY", max_length=8)
    idempotency_key: str | None = Field(default=None, max_length=160)
    metadata: dict[str, Any] = Field(default_factory=dict)

    @field_validator("provider")
    @classmethod
    def normalize_provider(cls, value: str) -> str:
        provider = value.strip().lower()
        if provider not in {"alipay", "wechat", "bank_transfer", "manual", "mock"}:
            raise ValueError("unsupported payment provider")
        return provider


class WalletRechargeOrderRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    wallet_id: UUID
    provider: str
    provider_trade_no: str | None
    idempotency_key: str
    status: str
    amount_cents: int
    credit_amount: Decimal
    currency: str
    paid_at: datetime | None
    payload: dict[str, Any]
    created_at: datetime
    updated_at: datetime


class PaymentWebhookResult(BaseModel):
    provider: str
    event_id: str
    duplicate: bool = False
    order_id: UUID | None = None
    status: str


class AdminMakeupRechargeRequest(BaseModel):
    reason: str = Field(min_length=3, max_length=500)
    provider_trade_no: str | None = Field(default=None, max_length=128)
    paid_at: datetime | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class AuditLogRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    actor_id: UUID | None
    action: str
    resource_type: str
    resource_id: str | None
    payload: dict[str, Any]
    created_at: datetime


class VideoReplaceEnqueueRequest(BaseModel):
    actor_id: UUID | None = None
    project_id: UUID | None = None
    task_id: UUID | None = None
    force: bool = False
    metadata: dict[str, Any] = Field(default_factory=dict)


class VideoReplaceJobRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    legacy_id: str | None
    task_id: UUID | None
    status: str
    progress: Decimal
    queue_name: str
    provider_job_id: UUID | None
    message: str | None
    error: str | None
    payload: dict[str, Any]
    created_at: datetime
    updated_at: datetime


class VideoReplaceEnqueueResponse(BaseModel):
    job: VideoReplaceJobRead
    task_id: UUID | None = None
    celery_task_id: str | None = None
    published: bool
    error: str | None = None


class VideoReplaceImportRequest(BaseModel):
    video_url: str = Field(min_length=1)
    original_filename: str | None = None
    project_id: UUID | None = None
    actor_id: UUID | None = None


class VideoReplaceReferenceImportRequest(BaseModel):
    image_url: str = Field(min_length=1)
    original_filename: str | None = None


class VideoReplaceDetectRequest(BaseModel):
    yolo_conf: float | None = Field(default=None, ge=0.05, le=0.95)
