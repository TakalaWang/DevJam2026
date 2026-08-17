"""Formatting and geometry helpers for the Streamlit UI."""

from typing import List, Tuple


def format_duration(seconds: int) -> str:
    """Present a duration in short, readable Traditional Chinese."""
    minutes = round(seconds / 60)
    hours, minutes = divmod(minutes, 60)
    if hours:
        return f"{hours} 小時 {minutes} 分鐘" if minutes else f"{hours} 小時"
    return f"{minutes} 分鐘"


def decode_polyline(encoded: str) -> List[Tuple[float, float]]:
    """Decode a Google encoded polyline into latitude/longitude pairs."""
    coordinates: List[Tuple[float, float]] = []
    index = latitude = longitude = 0
    while index < len(encoded):
        for is_latitude in (True, False):
            shift = result = 0
            while True:
                value = ord(encoded[index]) - 63
                index += 1
                result |= (value & 0x1F) << shift
                shift += 5
                if value < 0x20:
                    break
            delta = ~(result >> 1) if result & 1 else result >> 1
            if is_latitude:
                latitude += delta
            else:
                longitude += delta
        coordinates.append((latitude / 1e5, longitude / 1e5))
    return coordinates
