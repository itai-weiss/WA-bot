from __future__ import annotations

import hashlib
from datetime import datetime, timedelta
from typing import Sequence

from celery import Celery
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Group, Job, JobStatus, PendingSchedule, utcnow
from utils.time import default_tz, to_utc


def _get_celery() -> Celery:
    from app.workers import celery_app

    return celery_app


def _generate_correlation_key(group_id: str, text: str, run_at: datetime) -> str:
    payload = f"{group_id}|{text}|{run_at.isoformat()}".encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


def schedule_job(
    session: Session,
    *,
    group_alias: str,
    text: str,
    run_at: datetime,
    created_by: str,
    correlation_key: str | None = None,
) -> Job:
    group_alias_normalized = group_alias.lower()

    group = session.execute(
        select(Group).where(Group.alias == group_alias_normalized)
    ).scalar_one_or_none()
    if not group:
        raise ValueError(f"Unknown group alias '{group_alias}'. Use register group first.")

    run_at_utc = to_utc(run_at)
    current_utc = to_utc(datetime.now(default_tz()))
    # Allow near-immediate or just-past times (e.g., "now"),
    # but guard against clearly past schedules.
    if run_at_utc <= current_utc:
        if (current_utc - run_at_utc) <= timedelta(minutes=5):
            run_at_utc = current_utc + timedelta(seconds=10)
        else:
            raise ValueError("Scheduled time is in the past.")

    correlation_key = correlation_key or _generate_correlation_key(
        group.group_id, text, run_at_utc
    )

    existing_job = session.execute(
        select(Job).where(Job.correlation_key == correlation_key)
    ).scalar_one_or_none()
    if existing_job:
        return existing_job

    job = Job(
        group_id=group.group_id,
        group_alias=group.alias,
        text=text,
        run_at=run_at_utc,
        created_by=created_by,
        correlation_key=correlation_key,
    )
    session.add(job)
    session.flush()

    task = _get_celery().send_task(
        "app.workers.send_scheduled_message",
        args=[job.id],
        eta=run_at_utc,
        kwargs={},
    )
    job.celery_task_id = task.id

    return job


def get_group_by_alias(session: Session, alias: str) -> Group | None:
    alias_normalized = alias.lower()
    stmt = select(Group).where(Group.alias == alias_normalized)
    return session.execute(stmt).scalar_one_or_none()


def cancel_job(session: Session, job_id: int) -> bool:
    job = session.get(Job, job_id)
    if not job:
        return False
    if job.status in {JobStatus.CANCELLED, JobStatus.SENT}:
        return True

    job.status = JobStatus.CANCELLED
    job.last_error = None

    if job.celery_task_id:
        _get_celery().control.revoke(job.celery_task_id, terminate=False)
    return True


def list_jobs(session: Session) -> Sequence[Job]:
    stmt = (
        select(Job)
        .where(Job.status == JobStatus.SCHEDULED)
        .order_by(Job.run_at.asc())
    )
    return session.execute(stmt).scalars().all()


def get_pending_schedule(session: Session, owner_id: str) -> PendingSchedule | None:
    stmt = select(PendingSchedule).where(PendingSchedule.owner_id == owner_id)
    return session.execute(stmt).scalar_one_or_none()


def save_pending_schedule(
    session: Session,
    *,
    owner_id: str,
    group_alias: str,
    run_at: datetime,
) -> PendingSchedule:
    alias_normalized = group_alias.lower()
    run_at_utc = to_utc(run_at)
    pending = get_pending_schedule(session, owner_id)
    if pending:
        pending.group_alias = alias_normalized
        pending.run_at = run_at_utc
        pending.created_at = utcnow()
        return pending

    pending = PendingSchedule(
        owner_id=owner_id,
        group_alias=alias_normalized,
        run_at=run_at_utc,
    )
    session.add(pending)
    session.flush()
    return pending


def clear_pending_schedule(session: Session, owner_id: str) -> bool:
    pending = get_pending_schedule(session, owner_id)
    if not pending:
        return False
    session.delete(pending)
    return True


def register_group(
    session: Session, alias: str, group_id: str, group_name: str | None = None
) -> Group:
    alias_normalized = alias.lower()

    group = session.execute(
        select(Group).where(Group.alias == alias_normalized)
    ).scalar_one_or_none()
    if group:
        group.group_id = group_id
        group.group_name = group_name
        return group

    group = Group(alias=alias_normalized, group_id=group_id, group_name=group_name)
    session.add(group)
    session.flush()
    return group


def unregister_group(session: Session, alias: str) -> bool:
    alias_normalized = alias.lower()
    group = session.execute(
        select(Group).where(Group.alias == alias_normalized)
    ).scalar_one_or_none()
    if not group:
        return False
    session.delete(group)
    return True


def list_groups(session: Session) -> Sequence[Group]:
    stmt = select(Group).order_by(Group.alias.asc())
    return session.execute(stmt).scalars().all()


def mark_job_sent(session: Session, job_id: int) -> None:
    job = session.get(Job, job_id)
    if job:
        job.status = JobStatus.SENT
        job.last_error = None


def mark_job_failed(session: Session, job_id: int, error: str) -> None:
    job = session.get(Job, job_id)
    if job:
        job.status = JobStatus.FAILED
        job.last_error = error
