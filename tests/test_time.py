from zoneinfo import ZoneInfo

from freezegun import freeze_time

from utils.time import default_tz, parse_natural_datetime


@freeze_time("2024-01-01 06:00:00", tz_offset=0)
def test_parse_natural_datetime_today():
    tz = default_tz()
    dt = parse_natural_datetime("today 08:30", tz=tz)
    assert dt is not None
    assert dt.tzinfo is not None
    local = dt.astimezone(ZoneInfo("Asia/Jerusalem"))
    assert local.hour == 8
    assert local.minute == 30


def test_parse_natural_datetime_invalid():
    dt = parse_natural_datetime("not a real time")
    assert dt is None
