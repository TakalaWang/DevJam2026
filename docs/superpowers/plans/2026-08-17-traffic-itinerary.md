# Traffic-aware Daily Itinerary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Streamlit prototype that calculates and visualizes traffic-aware driving legs for a same-day itinerary.

**Architecture:** Pure itinerary and routing modules hold all testable business logic. A provider protocol separates Google Routes API traffic data from deterministic demo data; Streamlit only orchestrates form input and rendering.

**Tech Stack:** Python 3.11+, Streamlit, Folium, Requests, Pytest, Google Maps Routes API.

## Global Constraints

- Never send `GOOGLE_MAPS_API_KEY` to the browser or commit a `.env` file.
- Live requests use Google Routes API `computeRoutes`, `TRAFFIC_AWARE_OPTIMAL`, and alternatives.
- Without an API key, the UI must visibly state `Demo mode` and use deterministic responses.
- No network request may occur during tests.

---

### Task 1: Project setup and itinerary calculation

**Files:**
- Create: `requirements.txt`
- Create: `.gitignore`
- Create: `.env.example`
- Create: `src/traffic_planner/__init__.py`
- Create: `src/traffic_planner/itinerary.py`
- Create: `tests/test_itinerary.py`

**Interfaces:**
- Produces: `Stop(name: str, arrival_at: datetime)`, `parse_stops(text: str, day: date) -> list[Stop]`, and `leave_by(arrival_at: datetime, traffic_seconds: int) -> datetime`.

- [ ] **Step 1: Write the failing tests**

```python
from datetime import date, datetime
from traffic_planner.itinerary import leave_by, parse_stops


def test_parse_stops_accepts_time_then_place_lines():
    stops = parse_stops("14:00 | 台北 101\n18:00 | 內湖科技園區", date(2026, 8, 17))
    assert [stop.name for stop in stops] == ["台北 101", "內湖科技園區"]
    assert stops[0].arrival_at == datetime(2026, 8, 17, 14, 0)


def test_leave_by_subtracts_traffic_duration():
    assert leave_by(datetime(2026, 8, 17, 18, 0), 1_800) == datetime(2026, 8, 17, 17, 30)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_itinerary.py -v`

Expected: FAIL because `traffic_planner` does not exist.

- [ ] **Step 3: Implement the minimal package and configuration**

```python
# src/traffic_planner/itinerary.py
from dataclasses import dataclass
from datetime import date, datetime, timedelta

@dataclass(frozen=True)
class Stop:
    name: str
    arrival_at: datetime

def parse_stops(text: str, day: date) -> list[Stop]:
    return [Stop(place.strip(), datetime.combine(day, datetime.strptime(time.strip(), "%H:%M").time()))
            for line in text.splitlines() if line.strip()
            for time, place in [line.split("|", maxsplit=1)]]

def leave_by(arrival_at: datetime, traffic_seconds: int) -> datetime:
    return arrival_at - timedelta(seconds=traffic_seconds)
```

Create requirements containing `streamlit`, `folium`, `streamlit-folium`, `requests`, and `pytest`; ignore `.env`, `.venv/`, and `__pycache__/`; document `GOOGLE_MAPS_API_KEY=` in `.env.example`.

- [ ] **Step 4: Run test to verify it passes**

Run: `PYTHONPATH=src pytest tests/test_itinerary.py -v`

Expected: PASS with 2 tests.

### Task 2: Route result model and demo provider

**Files:**
- Create: `src/traffic_planner/routes.py`
- Create: `tests/test_routes.py`

**Interfaces:**
- Consumes: `Stop` from `traffic_planner.itinerary`.
- Produces: `RouteResult(origin: str, destination: str, normal_seconds: int, traffic_seconds: int, distance_meters: int, encoded_polyline: str | None)`, `DemoRouteProvider.get_route(origin: Stop, destination: Stop) -> RouteResult`, and `is_congested(route: RouteResult) -> bool`.

- [ ] **Step 1: Write the failing tests**

```python
from datetime import datetime
from traffic_planner.itinerary import Stop
from traffic_planner.routes import DemoRouteProvider, is_congested


def test_demo_provider_returns_repeatable_delayed_route():
    route = DemoRouteProvider().get_route(
        Stop("台北 101", datetime(2026, 8, 17, 14)),
        Stop("內湖科技園區", datetime(2026, 8, 17, 18)),
    )
    assert route.traffic_seconds > route.normal_seconds
    assert route.distance_meters > 0


def test_congestion_is_true_when_delay_exceeds_twenty_percent():
    route = DemoRouteProvider().get_route(
        Stop("台北 101", datetime(2026, 8, 17, 14)),
        Stop("內湖科技園區", datetime(2026, 8, 17, 18)),
    )
    assert is_congested(route) is True
```

- [ ] **Step 2: Run test to verify it fails**

Run: `PYTHONPATH=src pytest tests/test_routes.py -v`

Expected: FAIL because `traffic_planner.routes` does not exist.

- [ ] **Step 3: Implement the model and deterministic provider**

```python
@dataclass(frozen=True)
class RouteResult:
    origin: str
    destination: str
    normal_seconds: int
    traffic_seconds: int
    distance_meters: int
    encoded_polyline: str | None = None

def is_congested(route: RouteResult) -> bool:
    return route.traffic_seconds > route.normal_seconds * 1.2
```

Have `DemoRouteProvider` return a 22 km route with `normal_seconds=1_500` and `traffic_seconds=2_700` for the above Taipei 101 to Neihu pair, and a consistent low-delay result for all other pairs.

- [ ] **Step 4: Run test to verify it passes**

Run: `PYTHONPATH=src pytest tests/test_routes.py -v`

Expected: PASS with 2 tests.

### Task 3: Google Routes API provider

**Files:**
- Modify: `src/traffic_planner/routes.py`
- Modify: `tests/test_routes.py`

**Interfaces:**
- Produces: `GoogleRoutesProvider(api_key: str, post: Callable = requests.post)` with `get_route(origin: Stop, destination: Stop) -> RouteResult`.
- Consumes: Routes API response fields `routes[].duration`, `routes[].staticDuration`, `routes[].distanceMeters`, and `routes[].polyline.encodedPolyline`.

- [ ] **Step 1: Write the failing test**

```python
def test_google_provider_selects_shortest_traffic_route():
    calls = []
    def post(url, json, headers, timeout):
        calls.append((url, json, headers))
        return FakeResponse({"routes": [
            {"duration": "1800s", "staticDuration": "1200s", "distanceMeters": 12000},
            {"duration": "1500s", "staticDuration": "1300s", "distanceMeters": 13000,
             "polyline": {"encodedPolyline": "abc"}},
        ]})
    route = GoogleRoutesProvider("key", post=post).get_route(start, end)
    assert route.traffic_seconds == 1500
    assert route.encoded_polyline == "abc"
    assert calls[0][1]["routingPreference"] == "TRAFFIC_AWARE_OPTIMAL"
```

Define `FakeResponse.json()` in the test and use `start`/`end` Stops with valid datetimes.

- [ ] **Step 2: Run test to verify it fails**

Run: `PYTHONPATH=src pytest tests/test_routes.py::test_google_provider_selects_shortest_traffic_route -v`

Expected: FAIL because `GoogleRoutesProvider` is not defined.

- [ ] **Step 3: Implement API request and response selection**

Post to `https://routes.googleapis.com/directions/v2:computeRoutes` with `X-Goog-Api-Key`, an `X-Goog-FieldMask` covering the consumed fields, drive travel mode, `computeAlternativeRoutes=True`, and `departureTime` equal to the origin stop's ISO timestamp. Parse duration strings by removing their trailing `s`, then choose the route with minimum duration.

- [ ] **Step 4: Run test to verify it passes**

Run: `PYTHONPATH=src pytest tests/test_routes.py::test_google_provider_selects_shortest_traffic_route -v`

Expected: PASS.

### Task 4: Streamlit application and documentation

**Files:**
- Create: `app.py`
- Create: `README.md`
- Modify: `tests/test_itinerary.py`

**Interfaces:**
- Consumes: `parse_stops`, `leave_by`, `DemoRouteProvider`, `GoogleRoutesProvider`, `RouteResult`, and `is_congested`.
- Produces: runnable app via `streamlit run app.py`.

- [ ] **Step 1: Write the failing validation test**

```python
import pytest
from datetime import date
from traffic_planner.itinerary import parse_stops

def test_parse_stops_rejects_malformed_line():
    with pytest.raises(ValueError, match="HH:MM \\| 地點"):
        parse_stops("台北 101", date(2026, 8, 17))
```

- [ ] **Step 2: Run test to verify it fails**

Run: `PYTHONPATH=src pytest tests/test_itinerary.py::test_parse_stops_rejects_malformed_line -v`

Expected: FAIL because `split` raises a different error.

- [ ] **Step 3: Add input validation and build the UI**

Make `parse_stops` raise `ValueError("每行格式必須是 HH:MM | 地點")` for malformed lines. In `app.py`, show the structured input default, start location, date picker, an API-mode badge, route cards, and a Folium map. Use `DemoRouteProvider` if no environment key exists; otherwise catch provider failures and show `st.error`. Add README setup: create `.env`, enable Google Routes API, launch `streamlit run app.py`.

- [ ] **Step 4: Run all tests and launch smoke check**

Run: `PYTHONPATH=src pytest -v && PYTHONPATH=src streamlit run app.py --server.headless true`

Expected: all tests PASS and Streamlit starts without an import error.

