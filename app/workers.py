from __future__ import annotations

import contextlib

import httpx
import structlog
from celery import Celery, Task
from celery.schedules import crontab
from sqlalchemy import select

from app.config import get_settings
from app.db import session_scope
from app.logic import cleanup_expired_correlations, record_correlation
from app.models import Job, JobStatus, MessageCorrelation
from app.scheduler import mark_job_failed, mark_job_sent
from app.wa.client import WhatsAppClient

logger = structlog.get_logger(__name__)

settings = get_settings()

celery_app = Celery(
    "wa_bot",
    broker=settings.celery_broker_url,
    backend=settings.celery_result_backend,
)

celery_app.conf.update(
    task_default_queue="default",
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    timezone=settings.tz,
    enable_utc=True,
)


@celery_app.on_after_finalize.connect
def setup_periodic_tasks(sender, **kwargs):
    sender.add_periodic_task(
        crontab(minute="*/30"),
        cleanup_expired_records.s(),
        name="cleanup-expired-correlation",
    )


class DatabaseTask(Task):
    """Base task with failure handling tied to database updates."""

    def on_failure(self, exc, task_id, args, kwargs, einfo):
        job_id = kwargs.get("job_id") or (args[0] if args else None)
        if job_id is not None:
            with session_scope() as session:
                mark_job_failed(session, int(job_id), str(exc))
        logger.error(
            "worker.task_failure",
            task_name=self.name,
            job_id=job_id,
            exception=str(exc),
        )
        super().on_failure(exc, task_id, args, kwargs, einfo)


@celery_app.task(
    name="app.workers.send_scheduled_message",
    bind=True,
    base=DatabaseTask,
    max_retries=5,
)
def send_scheduled_message(self, job_id: int) -> None:
    with session_scope() as session:
        job = session.get(Job, job_id)
        if not job:
            logger.warning("worker.job_missing", job_id=job_id)
            return
        if job.status == JobStatus.CANCELLED:
            logger.info("worker.job_cancelled", job_id=job_id)
            return
        if job.status == JobStatus.SENT:
            logger.info("worker.job_already_sent", job_id=job_id)
            return

        existing_correlation = session.execute(
            select(MessageCorrelation).where(MessageCorrelation.job_id == job.id)
        ).scalar_one_or_none()
        if existing_correlation:
            mark_job_sent(session, job.id)
            logger.info("worker.job_correlation_exists", job_id=job_id)
            return

        client = WhatsAppClient()
        try:
            dest = job.group_id
            recipient_type = "group" if dest.endswith("@g.us") else "individual"
            response = client.send_text_message(
                to=dest,
                text=job.text,
                recipient_type=recipient_type,
            )
        except httpx.HTTPStatusError as exc:
            retries = self.request.retries + 1
            countdown = min(600, 30 * retries)
            logger.warning(
                "worker.job_http_retry",
                job_id=job_id,
                retries=retries,
                countdown=countdown,
                status_code=exc.response.status_code if exc.response else None,
            )
            raise self.retry(exc=exc, countdown=countdown)
        except Exception as exc:
            logger.exception("worker.job_send_failure", job_id=job_id)
            raise
        finally:
            with contextlib.suppress(Exception):
                client.close()

        messages = response.get("messages", [])
        if not messages:
            error_message = "No message id returned from WhatsApp"
            mark_job_failed(session, job.id, error_message)
            raise RuntimeError(error_message)

        bot_message_id = messages[0].get("id")

        record_correlation(
            session,
            job_id=job.id,
            group_id=job.group_id,
            bot_message_id=bot_message_id,
        )
        mark_job_sent(session, job.id)
        logger.info("worker.job_sent", job_id=job_id, message_id=bot_message_id)


@celery_app.task(name="app.workers.cleanup_expired_records")
def cleanup_expired_records() -> dict[str, int]:
    with session_scope() as session:
        removed = cleanup_expired_correlations(session)
    logger.info(
        "worker.cleanup_completed",
        removed_correlations=removed,
    )
    return {"removed_correlations": removed}
