from __future__ import annotations

import re
from dataclasses import dataclass


class CommandParseError(Exception):
    """Raised when the owner command cannot be parsed."""


@dataclass
class ScheduleCommand:
    text: str
    group_alias: str
    when: str


@dataclass
class ListCommand:
    pass


@dataclass
class CancelCommand:
    job_id: int


@dataclass
class RegisterGroupCommand:
    alias: str
    group_id: str
    group_name: str | None = None


@dataclass
class UnregisterGroupCommand:
    alias: str


@dataclass
class GroupsCommand:
    pass


OwnerCommand = (
    ScheduleCommand
    | ListCommand
    | CancelCommand
    | RegisterGroupCommand
    | UnregisterGroupCommand
    | GroupsCommand
)


SCHEDULE_RE = re.compile(
    r"""^schedule\s+"(?P<text>.+?)"\s+to\s+(?P<alias>[\w\-]+)\s+at\s+(?P<when>.+)$""",
    re.IGNORECASE,
)
REGISTER_RE = re.compile(
    r"""^register\s+group\s+(?P<alias>[\w\-]+)\s+(?P<group_id>[\w.@-]+)(?:\s+(?P<group_name>.+))?$""",
    re.IGNORECASE,
)
UNREGISTER_RE = re.compile(
    r"""^unregister\s+group\s+(?P<alias>[\w\-]+)$""",
    re.IGNORECASE,
)
CANCEL_RE = re.compile(r"""^cancel\s+(?P<job_id>\d+)$""", re.IGNORECASE)
LIST_RE = re.compile(r"""^list$""", re.IGNORECASE)
GROUPS_RE = re.compile(r"""^groups$""", re.IGNORECASE)


def parse_owner_command(message: str) -> OwnerCommand:
    """Parse the owner's text message into a structured command."""
    normalized = message.strip()
    if match := SCHEDULE_RE.match(normalized):
        return ScheduleCommand(
            text=match.group("text"),
            group_alias=match.group("alias"),
            when=match.group("when"),
        )

    if match := REGISTER_RE.match(normalized):
        group_name = match.group("group_name")
        if group_name:
            group_name = group_name.strip()
        return RegisterGroupCommand(
            alias=match.group("alias"),
            group_id=match.group("group_id"),
            group_name=group_name if group_name else None,
        )

    if match := UNREGISTER_RE.match(normalized):
        return UnregisterGroupCommand(alias=match.group("alias"))

    if match := CANCEL_RE.match(normalized):
        job_id = int(match.group("job_id"))
        return CancelCommand(job_id=job_id)

    if LIST_RE.match(normalized):
        return ListCommand()

    if GROUPS_RE.match(normalized):
        return GroupsCommand()

    raise CommandParseError("Unable to understand the command.")
