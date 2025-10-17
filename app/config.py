from __future__ import annotations

from functools import lru_cache
from typing import Optional

from pydantic import HttpUrl, ValidationInfo, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Application configuration loaded from environment variables."""

    wa_phone_number_id: str
    wa_business_account_id: str
    wa_access_token: str
    owner_wa_id: str
    verify_token: str
    base_url: HttpUrl

    tz: str = "Asia/Jerusalem"
    redis_url: str = "redis://localhost:6379/0"
    database_url: str = "sqlite:///./wa_bot.db"
    structlog_level: str = "INFO"

    celery_broker_url: Optional[str] = None
    celery_result_backend: Optional[str] = None

    x_admin_token: Optional[str] = None

    message_window_hours: int = 12
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    @field_validator("celery_broker_url", "celery_result_backend", mode="before")
    @classmethod
    def _default_celery_urls(
        cls, value: Optional[str], info: ValidationInfo
    ) -> str:
        if value:
            return value
        redis_url = info.data.get("redis_url") if info else None
        return redis_url or "redis://localhost:6379/0"


@lru_cache
def get_settings() -> Settings:
    return Settings()
