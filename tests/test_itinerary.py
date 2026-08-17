from datetime import date, datetime

import pytest

from traffic_planner.itinerary import leave_by, parse_stops


def test_parse_stops_accepts_time_then_place_lines():
    stops = parse_stops("14:00 | 台北 101\n18:00 | 內湖科技園區", date(2026, 8, 17))
    assert [stop.name for stop in stops] == ["台北 101", "內湖科技園區"]
    assert stops[0].arrival_at == datetime(2026, 8, 17, 14, 0)


def test_leave_by_subtracts_traffic_duration():
    assert leave_by(datetime(2026, 8, 17, 18, 0), 1_800) == datetime(2026, 8, 17, 17, 30)


def test_parse_stops_rejects_malformed_line():
    with pytest.raises(ValueError, match="HH:MM \\| 地點"):
        parse_stops("台北 101", date(2026, 8, 17))
