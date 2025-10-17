from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional
from zoneinfo import ZoneInfo

import dateparser

from app.config import get_settings


def default_tz() -> ZoneInfo:
    """Return the default timezone configured for the application."""
    return ZoneInfo(get_settings().tz)


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def ensure_tz(dt: datetime, tz: ZoneInfo) -> datetime:
    """Ensure a datetime is timezone-aware in the provided timezone."""
    if dt.tzinfo is None:
        return dt.replace(tzinfo=tz)
    return dt.astimezone(tz)


def to_utc(dt: datetime) -> datetime:
    """Convert any datetime to UTC (keeping timezone awareness)."""
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=default_tz())
    return dt.astimezone(timezone.utc)


def parse_natural_datetime(
    phrase: str, *, base: Optional[datetime] = None, tz: Optional[ZoneInfo] = None
) -> Optional[datetime]:
    """
    Parse natural language datetime expressions relative to the configured timezone.

    Returns a timezone-aware datetime in UTC if parsing succeeds.
    """
    tz = tz or default_tz()
    base_dt = base or datetime.now(tz)

    parsed = dateparser.parse(
        phrase,
        settings={
            "TIMEZONE": tz.key,
            "RETURN_AS_TIMEZONE_AWARE": True,
            "TO_TIMEZONE": tz.key,
            "PREFER_DATES_FROM": "future",
            "RELATIVE_BASE": base_dt,
        },
    )
    if not parsed:
        return None
    return to_utc(parsed)
