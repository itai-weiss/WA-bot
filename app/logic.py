from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Optional

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.models import MessageCorrelation
from utils.time import utc_now


def record_correlation(
    session: Session,
    *,
    job_id: int,
    group_id: str,
    bot_message_id: str,
    original_message_id: str | None = None,
) -> MessageCorrelation:
    settings = get_settings()
    expires_at = utc_now() + timedelta(hours=settings.message_window_hours)
    correlation = MessageCorrelation(
        job_id=job_id,
        group_id=group_id,
        bot_message_id=bot_message_id,
        original_message_id=original_message_id,
        window_expires_at=expires_at,
    )
    session.add(correlation)
    session.flush()
    return correlation


def find_correlation_for_context(
    session: Session, *, group_id: str, context_message_id: str | None
) -> Optional[MessageCorrelation]:
    now = utc_now()

    if context_message_id:
        correlation = session.execute(
            select(MessageCorrelation).where(
                MessageCorrelation.bot_message_id == context_message_id
            )
        ).scalar_one_or_none()
        if correlation and _window_in_future(correlation.window_expires_at, now):
            return correlation

    stmt = (
        select(MessageCorrelation)
        .where(
            MessageCorrelation.group_id == group_id,
            MessageCorrelation.window_expires_at > now,
        )
        .order_by(MessageCorrelation.created_at.desc())
    )
    correlation = session.execute(stmt).scalars().first()
    if correlation and _window_in_future(correlation.window_expires_at, now):
        return correlation
    return None


def cleanup_expired_correlations(session: Session) -> int:
    now = utc_now()
    result = session.execute(
        delete(MessageCorrelation).where(MessageCorrelation.window_expires_at < now)
    )
    return result.rowcount or 0


def _window_in_future(expires_at: datetime, now: datetime) -> bool:
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    return expires_at > now
