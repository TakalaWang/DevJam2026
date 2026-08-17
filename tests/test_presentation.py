from traffic_planner.presentation import format_duration


def test_format_duration_uses_hours_and_minutes():
    assert format_duration(2_700) == "45 分鐘"
    assert format_duration(5_400) == "1 小時 30 分鐘"
