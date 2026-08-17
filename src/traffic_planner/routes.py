"""Route providers for live Google data and deterministic demonstrations."""

from dataclasses import dataclass
from datetime import timedelta, timezone
from typing import Callable, Optional

import requests

from traffic_planner.itinerary import Stop

TAIPEI_TIMEZONE = timezone(timedelta(hours=8))


@dataclass(frozen=True)
class RouteResult:
    origin: str
    destination: str
    normal_seconds: int
    traffic_seconds: int
    distance_meters: int
    encoded_polyline: Optional[str] = None


def is_congested(route: RouteResult) -> bool:
    """Treat a traffic delay over 20% as a congestion warning."""
    return route.traffic_seconds > route.normal_seconds * 1.2


class DemoRouteProvider:
    """Predictable routes for presentations without a Google API key."""

    def get_route(self, origin: Stop, destination: Stop) -> RouteResult:
        if origin.name == "台北 101" and destination.name == "內湖科技園區":
            return RouteResult(origin.name, destination.name, 1_500, 2_700, 22_000)
        return RouteResult(origin.name, destination.name, 1_200, 1_260, 10_000)


class GoogleRoutesProvider:
    """Google Maps Routes API provider, called only from the server process."""

    endpoint = "https://routes.googleapis.com/directions/v2:computeRoutes"
    field_mask = "routes.duration,routes.staticDuration,routes.distanceMeters,routes.polyline.encodedPolyline"

    def __init__(self, api_key: str, post: Callable = requests.post):
        self.api_key = api_key
        self.post = post

    def get_route(self, origin: Stop, destination: Stop) -> RouteResult:
        response = self.post(
            self.endpoint,
            json={
                "origin": {"address": origin.name},
                "destination": {"address": destination.name},
                "travelMode": "DRIVE",
                "routingPreference": "TRAFFIC_AWARE_OPTIMAL",
                "computeAlternativeRoutes": True,
                "departureTime": origin.arrival_at.replace(tzinfo=TAIPEI_TIMEZONE).isoformat(),
            },
            headers={"X-Goog-Api-Key": self.api_key, "X-Goog-FieldMask": self.field_mask, "Content-Type": "application/json"},
            timeout=15,
        )
        response.raise_for_status()
        routes = response.json().get("routes", [])
        if not routes:
            raise ValueError("Google Routes API 沒有找到可用的開車路線")
        selected = min(routes, key=lambda item: self._seconds(item["duration"]))
        return RouteResult(
            origin.name,
            destination.name,
            self._seconds(selected.get("staticDuration", selected["duration"])),
            self._seconds(selected["duration"]),
            selected["distanceMeters"],
            selected.get("polyline", {}).get("encodedPolyline"),
        )

    @staticmethod
    def _seconds(value: str) -> int:
        return int(float(value.removesuffix("s")))
