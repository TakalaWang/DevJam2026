from datetime import datetime

from traffic_planner.itinerary import Stop
from traffic_planner.routes import DemoRouteProvider, GoogleRoutesProvider, is_congested


def test_demo_provider_returns_repeatable_delayed_route():
    route = DemoRouteProvider().get_route(Stop("台北 101", datetime(2026, 8, 17, 14)), Stop("內湖科技園區", datetime(2026, 8, 17, 18)))
    assert route.traffic_seconds > route.normal_seconds
    assert route.distance_meters > 0


def test_congestion_is_true_when_delay_exceeds_twenty_percent():
    route = DemoRouteProvider().get_route(Stop("台北 101", datetime(2026, 8, 17, 14)), Stop("內湖科技園區", datetime(2026, 8, 17, 18)))
    assert is_congested(route) is True


def test_google_provider_selects_shortest_traffic_route():
    class FakeResponse:
        def raise_for_status(self):
            return None

        def json(self):
            return {"routes": [
                {"duration": "1800s", "staticDuration": "1200s", "distanceMeters": 12000},
                {"duration": "1500s", "staticDuration": "1300s", "distanceMeters": 13000, "polyline": {"encodedPolyline": "abc"}},
            ]}

    calls = []

    def post(url, json, headers, timeout):
        calls.append((url, json, headers, timeout))
        return FakeResponse()

    route = GoogleRoutesProvider("key", post=post).get_route(Stop("台北 101", datetime(2026, 8, 17, 14)), Stop("內湖科技園區", datetime(2026, 8, 17, 18)))
    assert route.traffic_seconds == 1500
    assert route.encoded_polyline == "abc"
    assert calls[0][1]["routingPreference"] == "TRAFFIC_AWARE_OPTIMAL"
    assert calls[0][1]["departureTime"].endswith("+08:00")
