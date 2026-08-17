import {
  CoordinateSchema,
  RouteCalculationInputSchema,
  RoutePathSchema,
  RouteProviderResultSchema,
  type Coordinate,
  type RouteCalculationInput,
  type RoutePath,
  type RouteProfile,
  type RouteProviderResult,
  type RouteSignal,
  type RiskPolygon,
} from "../../contracts";
import { createDetourWaypointPairs, routeIntersectsPolygon } from "./geometry";
import type { RouteProvider } from "./planner";

const speedMetersPerSecond: Record<RouteProfile, number> = {
  car: 8,
  transit: 5,
  bike: 4,
  foot: 1.4,
};

function distanceMeters(points: Coordinate[]): number {
  return Math.max(
    100,
    Math.round(
      points.slice(1).reduce((total, point, index) => {
        const previous = points[index];
        if (!previous) return total;
        const latitudeMeters = (point.latitude - previous.latitude) * 111_000;
        const longitudeMeters =
          (point.longitude - previous.longitude) *
          111_000 *
          Math.cos((point.latitude * Math.PI) / 180);
        return total + Math.hypot(latitudeMeters, longitudeMeters);
      }, 0),
    ),
  );
}

function signalPolygon(signal: RouteSignal): RiskPolygon | undefined {
  return "polygon" in signal ? signal.polygon : undefined;
}

function detourCoordinates(input: RouteCalculationInput): Coordinate[] {
  const origin = input.request.origin.coordinate;
  const destination = input.request.destination.coordinate;
  const polygons = input.blockedSignals
    .map(signalPolygon)
    .filter((polygon): polygon is RiskPolygon => Boolean(polygon));
  if (!polygons.length) return [origin, destination];

  const candidates = polygons.flatMap((polygon) =>
    createDetourWaypointPairs(polygon, origin, destination),
  );
  const safe = candidates.find((waypoints) => {
    const route = [origin, ...waypoints, destination];
    return polygons.every((polygon) => !routeIntersectsPolygon(route, polygon));
  });
  return safe ? [origin, ...safe, destination] : [origin, destination];
}

function path(
  profile: RouteProfile,
  id: string,
  coordinates: Coordinate[],
  transitSteps: RoutePath["transitSteps"] = [],
): RoutePath {
  const distance = distanceMeters(coordinates);
  return RoutePathSchema.parse({
    id,
    profile,
    coordinates: coordinates.map((coordinate) => CoordinateSchema.parse(coordinate)),
    distanceMeters: distance,
    durationSeconds: Math.max(60, Math.ceil(distance / speedMetersPerSecond[profile])),
    stationIds: [],
    instructions: [],
    transitSteps,
    provider: "google",
  });
}

export class DemoRouteProvider implements RouteProvider {
  async calculate(rawInput: RouteCalculationInput): Promise<RouteProviderResult> {
    const input = RouteCalculationInputSchema.parse(rawInput);
    const profile = input.profile;
    const transitSteps: RoutePath["transitSteps"] =
      profile === "transit"
        ? [
            {
              mode: "metro",
              lineColor: "#e3002c",
              lineTextColor: "#ffffff",
              boardingStop: {
                name: input.request.origin.label,
                coordinate: input.request.origin.coordinate,
              },
              alightingStop: {
                name: input.request.destination.label,
                coordinate: input.request.destination.coordinate,
              },
            },
          ]
        : [];
    const direct = path(
      profile,
      `demo-${profile}-direct`,
      [input.request.origin.coordinate, input.request.destination.coordinate],
      transitSteps,
    );
    if (!input.blockedSignals.length) {
      return RouteProviderResultSchema.parse({ status: "ok", paths: [direct] });
    }
    const detour = path(profile, `demo-${profile}-detour`, detourCoordinates(input), transitSteps);
    const paths =
      JSON.stringify(direct.coordinates) === JSON.stringify(detour.coordinates)
        ? [detour]
        : [direct, detour];
    return RouteProviderResultSchema.parse({ status: "ok", paths });
  }
}
