from __future__ import annotations

import contextlib
from dataclasses import dataclass
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, Iterable

import httpx
from fastapi import BackgroundTasks, Depends, FastAPI, Header, HTTPException, Query, Request
from fastapi.responses import JSONResponse, PlainTextResponse
from sqlalchemy.orm import Session
import structlog

from app.commands import (
    CancelCommand,
    CommandParseError,
    GroupsCommand,
    ListCommand,
    RegisterGroupCommand,
    ScheduleCommand,
    ScheduleConfigCommand,
    UnregisterGroupCommand,
    parse_owner_command,
)
from app.config import Settings, get_settings
from app.db import create_all, get_session, session_scope
from app.logic import find_correlation_for_context
from app.scheduler import (
    cancel_job,
    clear_pending_schedule,
    get_group_by_alias,
    get_pending_schedule,
    list_groups,
    list_jobs,
    mark_job_sent,
    register_group,
    save_pending_schedule,
    schedule_job,
    unregister_group,
)
from app.schemas import GroupRead, JobListResponse
from app.wa.client import WhatsAppClient
from app.wa.templates import send_owner_notify
from utils.time import default_tz, parse_natural_datetime, utc_now

logger = structlog.get_logger(__name__)

app = FastAPI(title="WA Scheduler Bot", version="0.1.0")


@app.on_event("startup")
async def on_startup() -> None:
    create_all()
    logger.info("app.startup_completed")


@dataclass
class IncomingMessage:
    sender_wa_id: str
    sender_name: str | None
    message_id: str
    timestamp: datetime
    message_type: str
    text: str | None
    button_payload: str | None
    button_title: str | None
    context_message_id: str | None
    group_id: str | None
    group_name: str | None
    is_group: bool
    raw: Dict[str, Any]


def _parse_timestamp(value: str | None) -> datetime:
    if not value:
        return utc_now()
    try:
        as_int = int(value)
    except ValueError:
        return utc_now()
    return datetime.fromtimestamp(as_int, tz=timezone.utc)


def _extract_messages(payload: Dict[str, Any]) -> Iterable[IncomingMessage]:
    entries = payload.get("entry", [])
    for entry in entries:
        for change in entry.get("changes", []):
            value = change.get("value", {})
            contacts = {c.get("wa_id"): c.get("profile", {}).get("name") for c in value.get("contacts", [])}
            messages = value.get("messages", [])
            for message in messages:
                sender_id = message.get("from")
                sender_name = contacts.get(sender_id)
                msg_id = message.get("id")
                msg_type = message.get("type")
                text_body = None
                button_payload = None
                button_title = None

                if msg_type == "text":
                    text_body = message.get("text", {}).get("body")
                elif msg_type == "interactive":
                    interactive = message.get("interactive", {})
                    if interactive.get("type") == "button_reply":
                        button_reply = interactive.get("button_reply", {})
                        button_payload = button_reply.get("id")
                        button_title = button_reply.get("title")
                    elif interactive.get("type") == "list_reply":
                        list_reply = interactive.get("list_reply", {})
                        button_payload = list_reply.get("id")
                        button_title = list_reply.get("title")

                context = message.get("context", {}) or {}
                context_message_id = context.get("id")
                group_data = message.get("group", {}) or {}
                group_id = group_data.get("id") or context.get("group_id")
                group_name = group_data.get("subject") or group_data.get("name")
                is_group = bool(group_id)

                yield IncomingMessage(
                    sender_wa_id=sender_id,
                    sender_name=sender_name,
                    message_id=msg_id,
                    timestamp=_parse_timestamp(message.get("timestamp")),
                    message_type=msg_type,
                    text=text_body,
                    button_payload=button_payload,
                    button_title=button_title,
                    context_message_id=context_message_id,
                    group_id=group_id,
                    group_name=group_name,
                    is_group=is_group,
                    raw=message,
                )


@app.get("/healthz")
async def healthz() -> Dict[str, str]:
    return {"status": "ok"}




@app.post("/webhook/whatsapp")
async def whatsapp_webhook(
    request: Request,
    background_tasks: BackgroundTasks,
):
    payload = await request.json()
    logger.info("webhook.received", payload=payload)

    for message in _extract_messages(payload):
        if not message.sender_wa_id:
            continue
        if message.is_group:
            background_tasks.add_task(process_group_message, message)
        else:
            background_tasks.add_task(process_owner_message, message)
    return JSONResponse({"status": "accepted"})


def _owner_command_help() -> str:
    return (
        "Commands:\n"
        "- register group <alias> <group_id> [optional name]\n"
        "- unregister group <alias>\n"
        "- groups\n"
        '- schedule "<text>" to <alias> [at] <natural datetime>\n'
        '- schedule to <alias> [at] <natural datetime> (send content next)\n'
        "- list\n"
        "- cancel <job_id>\n"
        "Examples:\n"
        'schedule "Standup at 09:00" to team at today 08:55\n'
        'schedule "Demo tomorrow" to sales Sun 9am\n'
        'schedule to team at tomorrow 09:00\n'
        'schedule to team in 1 minute'
    )


def _require_admin_token(token: str | None) -> None:
    expected = get_settings().x_admin_token
    if expected and token == expected:
        return
    raise HTTPException(status_code=401, detail="Unauthorized")


@app.get("/jobs", response_model=JobListResponse)
async def list_jobs_endpoint(
    admin_token: str = Header(default=None, alias="X-Admin-Token"),
    session: Session = Depends(get_session),
):
    _require_admin_token(admin_token)
    jobs = list_jobs(session)
    return JobListResponse(jobs=jobs)


@app.delete("/jobs/{job_id}")
async def cancel_job_endpoint(
    job_id: int,
    admin_token: str = Header(default=None, alias="X-Admin-Token"),
    session: Session = Depends(get_session),
):
    _require_admin_token(admin_token)
    if not cancel_job(session, job_id):
        raise HTTPException(status_code=404, detail="Job not found")
    return {"status": "cancelled", "job_id": job_id}


@app.get("/groups", response_model=list[GroupRead])
async def groups_endpoint(
    admin_token: str = Header(default=None, alias="X-Admin-Token"),
    session: Session = Depends(get_session),
):
    _require_admin_token(admin_token)
    groups = list_groups(session)
    return [GroupRead.model_validate(group) for group in groups]


def process_owner_message(message: IncomingMessage) -> None:
    settings = get_settings()
    with session_scope() as session:
        if message.sender_wa_id != settings.owner_wa_id:
            logger.warning("owner.unauthorized_sender", sender=message.sender_wa_id)
            return

        pending_schedule = get_pending_schedule(session, settings.owner_wa_id)
        with whatsapp_client() as client:
            if message.button_payload:
                client.send_text_message(
                    to=settings.owner_wa_id,
                    text="Interactive actions are not supported.",
                )
                return

            if not message.text:
                if pending_schedule:
                    client.send_text_message(
                        to=settings.owner_wa_id,
                        text=(
                            "Pending schedule is waiting for content, but the message type "
                            "is unsupported. Please forward or send text content."
                        ),
                    )
                else:
                    client.send_text_message(
                        to=settings.owner_wa_id,
                        text="Unsupported message type. Send text commands.",
                    )
                return

            try:
                command = parse_owner_command(message.text)
            except CommandParseError:
                if pending_schedule:
                    _complete_pending_schedule(
                        session,
                        client,
                        settings,
                        pending_schedule,
                        message.text,
                    )
                else:
                    client.send_text_message(
                        to=settings.owner_wa_id,
                        text="Could not parse command.\n" + _owner_command_help(),
                    )
                return
            handle_owner_command(command, session, client, settings)


def _complete_pending_schedule(
    session: Session,
    client: WhatsAppClient,
    settings: Settings,
    pending_schedule,
    content_text: str,
) -> None:
    if not content_text.strip():
        client.send_text_message(
            to=settings.owner_wa_id,
            text="Cannot schedule an empty message. Please send the content text.",
        )
        return

    # If the configured run_at has just passed by the time content arrives,
    # schedule it for asap with a small grace buffer instead of failing.
    now = utc_now()
    run_at = pending_schedule.run_at
    # Normalize possible naive datetimes coming from SQLite
    if run_at.tzinfo is None:
        run_at = run_at.replace(tzinfo=timezone.utc)
    created_at = getattr(pending_schedule, "created_at", None)
    if created_at is not None and created_at.tzinfo is None:
        created_at = created_at.replace(tzinfo=timezone.utc)
    adjusted = False
    if run_at <= now:
        # Consider recent configs as eligible for auto-adjust (e.g., "in 1 minute").
        try:
            basis = created_at if created_at is not None else now
            if (now - basis) <= timedelta(minutes=5):
                run_at = now + timedelta(seconds=10)
                adjusted = True
        except Exception:
            # Fallback to original behavior if something unexpected occurs.
            pass

    try:
        job = schedule_job(
            session,
            group_alias=pending_schedule.group_alias,
            text=content_text,
            run_at=run_at,
            created_by=settings.owner_wa_id,
        )
    except ValueError as exc:
        clear_pending_schedule(session, settings.owner_wa_id)
        client.send_text_message(to=settings.owner_wa_id, text=str(exc))
        return

    clear_pending_schedule(session, settings.owner_wa_id)
    run_at_local = run_at.astimezone(default_tz())
    if adjusted:
        text = (
            f"Original time had just passed; scheduled job #{job.id} to "
            f"'{pending_schedule.group_alias}' at {run_at_local.strftime('%Y-%m-%d %H:%M %Z')} "
            f"using forwarded content."
        )
    else:
        text = (
            f"Scheduled job #{job.id} to '{pending_schedule.group_alias}' at "
            f"{run_at_local.strftime('%Y-%m-%d %H:%M %Z')} using forwarded content."
        )
    client.send_text_message(to=settings.owner_wa_id, text=text)


def handle_owner_command(
    command: ScheduleCommand
    | ScheduleConfigCommand
    | ListCommand
    | CancelCommand
    | GroupsCommand
    | RegisterGroupCommand
    | UnregisterGroupCommand,
    session: Session,
    client: WhatsAppClient,
    settings: Settings,
) -> None:
    if isinstance(command, ScheduleCommand):
        run_at_utc = parse_natural_datetime(command.when, tz=default_tz())
        if not run_at_utc:
            client.send_text_message(
                to=settings.owner_wa_id,
                text=(
                    "Could not parse the schedule time. Please try again.\n"
                    + _owner_command_help()
                ),
            )
            return
        run_at_local = run_at_utc.astimezone(default_tz())
        try:
            job = schedule_job(
                session,
                group_alias=command.group_alias,
                text=command.text,
                run_at=run_at_utc,
                created_by=settings.owner_wa_id,
            )
        except ValueError as exc:
            client.send_text_message(to=settings.owner_wa_id, text=str(exc))
            return

        clear_pending_schedule(session, settings.owner_wa_id)
        client.send_text_message(
            to=settings.owner_wa_id,
            text=(
                f"Scheduled job #{job.id} to '{command.group_alias}' at "
                f"{run_at_local.strftime('%Y-%m-%d %H:%M %Z')}."
            ),
        )

    elif isinstance(command, ScheduleConfigCommand):
        run_at_utc = parse_natural_datetime(command.when, tz=default_tz())
        if not run_at_utc:
            client.send_text_message(
                to=settings.owner_wa_id,
                text=(
                    "Could not parse the schedule time. Please try again.\n"
                    + _owner_command_help()
                ),
            )
            return

        group = get_group_by_alias(session, command.group_alias)
        if not group:
            client.send_text_message(
                to=settings.owner_wa_id,
                text=(
                    f"Unknown group alias '{command.group_alias}'. Use register group first."
                ),
            )
            return

        if run_at_utc <= utc_now():
            client.send_text_message(
                to=settings.owner_wa_id,
                text="Scheduled time is in the past. Please choose a future time.",
            )
            return

        save_pending_schedule(
            session,
            owner_id=settings.owner_wa_id,
            group_alias=group.alias,
            run_at=run_at_utc,
        )

        run_at_local = run_at_utc.astimezone(default_tz())
        client.send_text_message(
            to=settings.owner_wa_id,
            text=(
                "Configuration stored. Forward or send the message content to "
                f"schedule it to '{group.alias}' at "
                f"{run_at_local.strftime('%Y-%m-%d %H:%M %Z')}."
            ),
        )

    elif isinstance(command, ListCommand):
        jobs = list_jobs(session)
        if not jobs:
            client.send_text_message(to=settings.owner_wa_id, text="No jobs scheduled.")
            return
        lines = []
        for job in jobs:
            local_time = job.run_at.astimezone(default_tz())
            lines.append(
                f"#{job.id} {job.group_alias} at {local_time.strftime('%Y-%m-%d %H:%M %Z')} \"{job.text}\""
            )
        client.send_text_message(to=settings.owner_wa_id, text="\n".join(lines))

    elif isinstance(command, CancelCommand):
        if cancel_job(session, command.job_id):
            client.send_text_message(
                to=settings.owner_wa_id,
                text=f"Cancelled job #{command.job_id}.",
            )
        else:
            client.send_text_message(
                to=settings.owner_wa_id,
                text=f"Job #{command.job_id} not found.",
            )

    elif isinstance(command, GroupsCommand):
        groups = list_groups(session)
        if not groups:
            client.send_text_message(
                to=settings.owner_wa_id,
                text="No groups registered. Use 'register group <alias> <group_id>'.",
            )
            return
        lines = [
            f"{group.alias} -> {group.group_id}" + (f" ({group.group_name})" if group.group_name else "")
            for group in groups
        ]
        client.send_text_message(to=settings.owner_wa_id, text="\n".join(lines))

    elif isinstance(command, RegisterGroupCommand):
        group = register_group(
            session,
            alias=command.alias,
            group_id=command.group_id,
            group_name=command.group_name,
        )
        client.send_text_message(
            to=settings.owner_wa_id,
            text=f"Registered group '{group.alias}' with ID {group.group_id}.",
        )

    elif isinstance(command, UnregisterGroupCommand):
        if unregister_group(session, command.alias):
            client.send_text_message(
                to=settings.owner_wa_id,
                text=f"Unregistered group '{command.alias}'.",
            )
        else:
            client.send_text_message(
                to=settings.owner_wa_id,
                text=f"Group '{command.alias}' not found.",
            )


def process_group_message(message: IncomingMessage) -> None:
    settings = get_settings()
    if not message.group_id or message.sender_wa_id == settings.wa_phone_number_id:
        return

    with session_scope() as session:
        correlation = find_correlation_for_context(
            session,
            group_id=message.group_id,
            context_message_id=message.context_message_id,
        )
    if not correlation:
        return

    snippet = message.text or f"{message.message_type} message"
    snippet = snippet[:180]
    sender_display = message.sender_name or message.sender_wa_id
    body = f"[Group: {message.group_name or message.group_id}] {sender_display}: {snippet}"

    buttons = [
        {
            "type": "url",
            "url": {
                "url": f"https://wa.me/{message.sender_wa_id}",
                "display_text": f"Open chat with {sender_display}",
            },
        },
    ]

    with whatsapp_client() as client:
        try:
            client.send_interactive_message(
                to=settings.owner_wa_id,
                header=None,
                body=body,
                buttons=buttons,
            )
        except httpx.HTTPStatusError as exc:
            if _should_use_template(exc):
                send_owner_notify(
                    client,
                    to=settings.owner_wa_id,
                    group_name=message.group_name or message.group_id,
                    sender_name=sender_display,
                    snippet=snippet,
                    cta_url=f"https://wa.me/{message.sender_wa_id}",
                )
            else:
                raise


def _should_use_template(exc: httpx.HTTPStatusError) -> bool:
    response = exc.response
    if not response:
        return False
    try:
        payload = response.json()
    except ValueError:
        return False
    error = payload.get("error", {})
    code = error.get("code")
    subcode = error.get("error_subcode")
    return code == 470 or subcode in {2018041, 2018042, 2018046}


@contextlib.contextmanager
def whatsapp_client() -> Iterable[WhatsAppClient]:
    client = WhatsAppClient()
    try:
        yield client
    finally:
        with contextlib.suppress(Exception):
            client.close()
@app.get("/webhook/whatsapp")
async def verify_webhook(
    # Meta sends these with dots in the names; map via aliases
    hub_mode: str | None = Query(default=None, alias="hub.mode"),
    hub_challenge: str | None = Query(default=None, alias="hub.challenge"),
    hub_verify_token: str | None = Query(default=None, alias="hub.verify_token"),
):
    settings = get_settings()
    if hub_mode == "subscribe" and hub_verify_token == settings.verify_token:
        return PlainTextResponse(hub_challenge or "")
    raise HTTPException(status_code=403, detail="Verification failed")
