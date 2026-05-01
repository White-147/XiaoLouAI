from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import AnyHttpUrl, Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


def _normalize_asyncpg_url(value: str) -> str:
    if value.startswith("postgres://"):
        value = "postgresql://" + value[len("postgres://") :]
    if value.startswith("postgresql://"):
        value = "postgresql+asyncpg://" + value[len("postgresql://") :]
    return value


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_name: str = "xiaolou-api"
    environment: Literal["local", "staging", "production"] = "local"
    log_level: str = "INFO"
    public_base_url: str = "http://127.0.0.1:8000"
    frontend_base_url: str = "http://127.0.0.1:3000"
    cors_origins: list[str] = Field(default_factory=lambda: ["http://127.0.0.1:3000"])

    database_url: str = "postgresql+asyncpg://root:root@127.0.0.1:5432/xiaolou"
    read_database_url: str | None = None
    pgbouncer_database_url: str | None = None
    postgres_user: str = "root"
    postgres_password: str = "root"
    postgres_db: str = "xiaolou"
    database_schema: str = ""
    db_pool_size: int = 20
    db_max_overflow: int = 20
    db_pool_timeout: int = 5
    db_statement_timeout_ms: int = 30_000

    task_publish_enabled: bool = False
    task_publish_fail_fast: bool = False
    provider_poll_interval_seconds: int = 15
    provider_job_timeout_seconds: int = 3600

    storage_backend: Literal["local", "s3"] = "local"
    local_upload_dir: str = "./runtime/uploads"
    object_store_bucket: str = "xiaolou-assets"
    object_store_endpoint: str | None = None
    object_store_access_key: str | None = None
    object_store_secret_key: str | None = None

    payment_mock_allowed_hosts: str = ""
    payment_replay_window_seconds: int = 300
    pay_public_base_url: str | None = None
    alipay_env: Literal["sandbox", "production"] = "sandbox"
    alipay_app_id: str | None = None
    alipay_seller_id: str | None = None
    alipay_private_key: str | None = None
    alipay_public_key: str | None = None
    wechat_pay_app_id: str | None = None
    wechat_pay_mch_id: str | None = None
    wechat_pay_private_key: str | None = None
    wechat_pay_cert_serial: str | None = None
    wechat_pay_api_v3_key: str | None = None
    wechat_pay_platform_public_key: str | None = None

    provider_default_video_model: str = "cloud:video:default"
    provider_default_image_model: str = "cloud:image:default"
    cloud_provider_base_url: AnyHttpUrl | None = None
    cloud_provider_api_key: str | None = None
    local_provider_base_url: str = "http://local-model-gateway:9000"
    video_replace_service_dir: str = str(Path(__file__).resolve().parents[3] / "video-replace-service")
    video_replace_python_path: str | None = None
    video_replace_pipeline_timeout_seconds: int = 10_800
    video_replace_detect_timeout_seconds: int = 120
    video_replace_model_id: str = "local:video:replace"
    video_replace_kill_on_cancel: bool = True
    video_replace_core_api_base_url: str = "http://127.0.0.1:4100"
    video_replace_max_upload_mb: int = 500
    video_replace_max_video_seconds: int = 15
    video_replace_reference_max_mb: int = 25

    @field_validator("database_url", "read_database_url", "pgbouncer_database_url", mode="before")
    @classmethod
    def normalize_database_url(cls, value: str | None) -> str | None:
        return _normalize_asyncpg_url(value) if value else value

    @field_validator("cors_origins", mode="before")
    @classmethod
    def parse_cors_origins(cls, value: str | list[str]) -> list[str]:
        if isinstance(value, str):
            return [item.strip() for item in value.split(",") if item.strip()]
        return value


@lru_cache
def get_settings() -> Settings:
    return Settings()
