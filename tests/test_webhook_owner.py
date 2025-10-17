from __future__ import annotations

from freezegun import freeze_time

from app.main import IncomingMessage, process_owner_message
from app.db import session_scope
from app.models import Group, Job, PendingSchedule
from utils.time import utc_now


def make_message(text: str | None, *, button_payload: str | None = None) -> IncomingMessage:
    return IncomingMessage(
        sender_wa_id="owner-wa-id",
        sender_name="Owner",
        message_id="msg-1",
        timestamp=utc_now(),
        message_type="text" if text is not None else "interactive",
        text=text,
        button_payload=button_payload,
        button_title=None,
        context_message_id=None,
        group_id=None,
        group_name=None,
        is_group=False,
        raw={},
    )


def test_owner_register_and_schedule_flow(client_spy, celery_stub):
    register_msg = make_message("register group team 12345@g.us Team Group")
    process_owner_message(register_msg)

    with session_scope() as session:
        groups = session.query(Group).all()
        assert len(groups) == 1
        assert groups[0].alias == "team"

    with freeze_time("2024-01-01 06:00:00", tz_offset=0):
        schedule_msg = make_message(
            'schedule "Daily sync" to team at today 08:55'
        )
        process_owner_message(schedule_msg)

    with session_scope() as session:
        jobs = session.query(Job).all()
        assert len(jobs) == 1
        assert jobs[0].text == "Daily sync"

    sent_texts = [msg for msg in client_spy if msg[0] == "text"]
    assert sent_texts, "Expected responses sent to owner"


def test_owner_two_step_schedule_flow(client_spy, celery_stub):
    register_msg = make_message("register group team 12345@g.us Team Group")
    process_owner_message(register_msg)

    with freeze_time("2024-01-01 06:00:00", tz_offset=0):
        config_msg = make_message("schedule to team at tomorrow 08:55")
        process_owner_message(config_msg)

        with session_scope() as session:
            pending = session.query(PendingSchedule).one()
            assert pending.group_alias == "team"

        content_msg = make_message("Forwarded standup notes")
        process_owner_message(content_msg)

    with session_scope() as session:
        jobs = session.query(Job).all()
        assert len(jobs) == 1
        assert jobs[0].text == "Forwarded standup notes"

        pending_remaining = session.query(PendingSchedule).all()
        assert not pending_remaining

    confirmations = [kwargs for kind, kwargs in client_spy if kind == "text"]
    assert any("Configuration stored" in msg["text"] for msg in confirmations)
    assert any("using forwarded content" in msg["text"] for msg in confirmations)
