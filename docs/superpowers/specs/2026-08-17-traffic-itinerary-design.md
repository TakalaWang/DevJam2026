# Traffic-aware daily itinerary prototype

## Goal

Build a local Streamlit demo that turns a user-entered same-day itinerary into driving-leg recommendations based on live or predicted traffic from Google Maps Routes API.

## Scope

- Accept structured stops (place name and required arrival time) and an optional starting location/time.
- Query Google Routes API `computeRoutes` for driving routes with `departureTime`, `TRAFFIC_AWARE_OPTIMAL` routing, and alternatives.
- Display the chosen route per consecutive stop, normal and traffic-aware durations, a congestion warning, and a recommended leave-by time.
- Render stops and the recommended route polyline on a Folium map.
- When `GOOGLE_MAPS_API_KEY` is absent, use deterministic demo responses and visibly label the page `Demo mode`.

## Non-goals

- The first prototype does not use an LLM or automatically reorder stops. Fixed appointment order makes schedule constraints predictable and testable.
- It does not expose API keys to the browser or commit `.env`.
- It does not claim congestion data in demo mode.

## Architecture

`itinerary.py` parses validated stop lines and calculates leave-by times. `routes.py` isolates Google Routes HTTP calls behind a `RouteProvider` protocol and includes a deterministic `DemoRouteProvider`. `app.py` binds Streamlit input to those services and maps returned route polylines.

The Google provider sends API requests from the local Streamlit process, asks for alternatives, selects the route with the lowest traffic-aware duration, and returns a stable `RouteResult` value. Any unavailable API response becomes a user-facing error; it is never silently shown as traffic data.

## UX

The default itinerary demonstrates Taipei 101 → Dadaocheng → Neihu Technology Park. Each result card shows distance, normal duration, traffic duration, traffic delay, and leave-by time. A delayed route uses an orange warning and the map line is colored orange; lower-delay routes are green.

## Testing

Unit tests cover parsing, leave-by time computation, congestion classification, deterministic demo routes, and Google response parsing through injected HTTP requests. Network calls are not made in test runs.

## Configuration

`GOOGLE_MAPS_API_KEY` enables live mode. Google Cloud must have the Routes API enabled and billing configured. `.env.example` documents the variable; `.env` is ignored.
