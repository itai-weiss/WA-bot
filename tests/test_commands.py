from app.commands import (
    CancelCommand,
    CommandParseError,
    GroupsCommand,
    ListCommand,
    RegisterGroupCommand,
    ScheduleCommand,
    UnregisterGroupCommand,
    parse_owner_command,
)


def test_parse_schedule_command():
    command = parse_owner_command(
        'schedule "Daily sync" to team at today 08:55'
    )
    assert isinstance(command, ScheduleCommand)
    assert command.text == "Daily sync"
    assert command.group_alias == "team"
    assert "today" in command.when


def test_parse_cancel_command():
    command = parse_owner_command("cancel 42")
    assert isinstance(command, CancelCommand)
    assert command.job_id == 42


def test_parse_register_group_command():
    command = parse_owner_command(
        "register group team 12345@g.us Team Squad"
    )
    assert isinstance(command, RegisterGroupCommand)
    assert command.alias == "team"
    assert command.group_id == "12345@g.us"
    assert command.group_name == "Team Squad"


def test_parse_unregister_group_command():
    command = parse_owner_command("unregister group team")
    assert isinstance(command, UnregisterGroupCommand)
    assert command.alias == "team"


def test_parse_list_command():
    command = parse_owner_command("list")
    assert isinstance(command, ListCommand)


def test_parse_groups_command():
    command = parse_owner_command("groups")
    assert isinstance(command, GroupsCommand)


def test_parse_invalid_command():
    try:
        parse_owner_command("unknown command")
    except CommandParseError:
        assert True
    else:
        raise AssertionError("Expected CommandParseError")
