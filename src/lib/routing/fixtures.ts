import {
  RouteProviderResultSchema,
  type RouteCalculationInput,
  type RoutePath,
  type RouteProfile,
  type RouteProviderResult,
  type RouteRequest,
  type RouteSignal,
} from "../../contracts";
import type { RouteProvider } from "./planner";

export type FixtureRouteSet = {
  profile: RouteProfile;
  normal: RoutePath[];
  rerouted: RoutePath[];
};

function requiresReroute(signals: RouteSignal[]): boolean {
  return signals.some(
    (signal) =>
      signal.kind === "flood_zone" ||
      signal.kind === "road_closure" ||
      signal.kind === "station_disruption" ||
      signal.kind === "low_lighting",
  );
}

export class FixtureGraphHopperProvider implements RouteProvider {
  private readonly routes: FixtureRouteSet[];

  constructor(routes: FixtureRouteSet[]) {
    this.routes = routes;
  }

  calculate(input: RouteCalculationInput): Promise<RouteProviderResult> {
    const request: RouteRequest = input.request;
    const routeSet = this.routes.find((candidate) => candidate.profile === input.profile);
    if (!routeSet || !request.profiles.includes(input.profile)) {
      return Promise.resolve(
        RouteProviderResultSchema.parse({
          status: "unavailable",
          reason: `fixture 沒有 ${input.profile} 路線`,
        }),
      );
    }
    return Promise.resolve(
      RouteProviderResultSchema.parse({
        status: "ok",
        paths: requiresReroute(input.blockedSignals) ? routeSet.rerouted : routeSet.normal,
      }),
    );
  }
}
