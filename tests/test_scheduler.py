from __future__ import annotations

from datetime import datetime, timedelta, timezone

from app.scheduler import cancel_job, list_jobs, register_group, schedule_job
from app.models import JobStatus
from app.db import session_scope


def test_schedule_and_cancel_job(celery_stub):
    future_time = datetime.now(timezone.utc) + timedelta(hours=1)
    with session_scope() as session:
        register_group(session, "team", "12345@g.us", "Team")
        job = schedule_job(
            session,
            group_alias="team",
            text="Daily update",
            run_at=future_time,
            created_by="owner-wa-id",
        )
        session.flush()
        assert job.id is not None
        assert job.status == JobStatus.SCHEDULED
        assert job.celery_task_id is not None

    assert celery_stub.sent, "Expected celery send_task to be called"

    with session_scope() as session:
        jobs = list_jobs(session)
        assert len(jobs) == 1
        assert jobs[0].id == job.id

    with session_scope() as session:
        cancelled = cancel_job(session, job.id)
        assert cancelled is True
