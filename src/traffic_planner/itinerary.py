"""Itinerary parsing and timing helpers."""

from dataclasses import dataclass
from datetime import date, datetime, timedelta


@dataclass(frozen=True)
class Stop:
    """A location that must be reached at a particular local time."""

    name: str
    arrival_at: datetime


def parse_stops(text: str, day: date) -> list[Stop]:
    """Parse one `HH:MM | location` stop per non-empty line."""
    stops: list[Stop] = []
    for line in text.splitlines():
        if not line.strip():
            continue
        try:
            time_text, place = line.split("|", maxsplit=1)
            arrival_time = datetime.strptime(time_text.strip(), "%H:%M").time()
        except ValueError as error:
            raise ValueError("每行格式必須是 HH:MM | 地點") from error
        if not place.strip():
            raise ValueError("每行格式必須是 HH:MM | 地點")
        stops.append(Stop(name=place.strip(), arrival_at=datetime.combine(day, arrival_time)))
    return stops


def leave_by(arrival_at: datetime, traffic_seconds: int) -> datetime:
    """Return the latest departure time that reaches an appointment on time."""
    return arrival_at - timedelta(seconds=traffic_seconds)
