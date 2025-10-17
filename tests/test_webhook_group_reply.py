from __future__ import annotations

from datetime import timedelta

from app.main import IncomingMessage, process_group_message
from app.db import session_scope
from app.models import Job, JobStatus, MessageCorrelation
from utils.time import utc_now


def create_job_with_correlation(group_id: str, bot_message_id: str) -> None:
    with session_scope() as session:
        job = Job(
            group_id=group_id,
            group_alias="team",
            text="Scheduled message",
            run_at=utc_now(),
            created_by="owner-wa-id",
            status=JobStatus.SENT,
            correlation_key=f"{group_id}:{bot_message_id}",
        )
        session.add(job)
        session.flush()
        correlation = MessageCorrelation(
            job_id=job.id,
            group_id=group_id,
            bot_message_id=bot_message_id,
            window_expires_at=utc_now() + timedelta(hours=6),
        )
        session.add(correlation)


def make_group_message(
    *,
    group_id: str,
    context_id: str,
    sender_wa_id: str = "user-wa-id",
    text: str = "Reply text",
) -> IncomingMessage:
    return IncomingMessage(
        sender_wa_id=sender_wa_id,
        sender_name="Teammate",
        message_id="group-msg-1",
        timestamp=utc_now(),
        message_type="text",
        text=text,
        button_payload=None,
        button_title=None,
        context_message_id=context_id,
        group_id=group_id,
        group_name="Team Group",
        is_group=True,
        raw={},
    )


def test_group_reply_forward_to_owner(client_spy):
    create_job_with_correlation("12345@g.us", "bot-msg-id")
    message = make_group_message(group_id="12345@g.us", context_id="bot-msg-id")
    process_group_message(message)

    sent = [entry for entry in client_spy if entry[0] == "interactive"]
    assert sent, "Expected interactive message sent to owner"
    interactive_payload = sent[0][1]
    assert "buttons" in interactive_payload
    buttons = interactive_payload["buttons"]
    assert len(buttons) == 1
    assert buttons[0]["type"] == "url"
