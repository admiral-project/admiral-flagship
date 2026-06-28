from app.bff.dashboard import (
    _as_list,
    _safe_int,
    _status_lower,
    _first,
    _parse_datetime,
    _duration_seconds,
    _progress_percent,
)


def test_as_list():
    assert _as_list([1, 2]) == [1, 2]
    assert _as_list({"items": [3, 4]}) == [3, 4]
    assert _as_list({"data": [5, 6]}) == [5, 6]
    assert _as_list(None) == []
    assert _as_list("not a list") == []


def test_safe_int():
    assert _safe_int(10) == 10
    assert _safe_int(10.5) == 10
    assert _safe_int("10") == 0


def test_status_lower():
    assert _status_lower({"status": "RUNNING"}) == "running"
    assert _status_lower({"technical_status": "PAUSED"}) == "paused"
    assert _status_lower(None) == ""


def test_first():
    item = {"a": 1, "b": 2}
    assert _first(item, "c", "b", "a") == 2
    assert _first(item, "d", default="def") == "def"
    assert _first(None, "a") == ""


def test_parse_datetime():
    assert _parse_datetime("2023-01-01T12:00:00Z") is not None
    assert _parse_datetime("invalid") is None
    assert _parse_datetime(None) is None


def test_duration_seconds():
    item = {"started_at": "2023-01-01T12:00:00Z", "finished_at": "2023-01-01T12:00:10Z"}
    assert _duration_seconds(item) == 10
    assert _duration_seconds({"duration": 5}) == 5
    assert _duration_seconds({}) is None


def test_progress_percent():
    assert _progress_percent({"progress": 50}) == 50
    assert _progress_percent({"progress_percent": 150}) == 100
    assert _progress_percent({"percent_complete": -10}) == 0
    assert _progress_percent({}) is None
