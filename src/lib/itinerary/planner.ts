import {
  DayItinerarySnapshotSchema,
  ItineraryTimestampSchema,
  TravelLegSchema,
  RouteRequestSchema,
  type DayItinerarySnapshot,
  type ItineraryStop,
  type RouteSignal,
  type TravelLeg,
} from "../../contracts";
import { RoutePlanner } from "../routing/planner";

function timestamp(): string {
  return ItineraryTimestampSchema.parse(new Date().toISOString());
}

function legId(fromStopId: string, toStopId: string): string {
  return `leg-${fromStopId}-${toStopId}`;
}

function updateTimeReviews(snapshot: DayItinerarySnapshot, legs: TravelLeg[]): ItineraryStop[] {
  if (!snapshot.startAt) return snapshot.stops;
  let current = Date.parse(snapshot.startAt);
  return snapshot.stops.map((stop, index) => {
    const leg = legs[index];
    const arrival = leg?.route ? current + leg.route.durationSeconds * 1000 : current;
    const outsideWindow = stop.timeWindow ? arrival > Date.parse(stop.timeWindow.endAt) : false;
    current = arrival + stop.durationMinutes * 60_000;
    return {
      ...stop,
      status: outsideWindow
        ? "needs_review"
        : stop.status === "needs_review"
          ? "planned"
          : stop.status,
    };
  });
}

export class DayItineraryPlanner {
  constructor(private readonly routePlanner: RoutePlanner) {}

  async rebuild(
    rawSnapshot: DayItinerarySnapshot,
    rawSignals: RouteSignal[],
  ): Promise<DayItinerarySnapshot> {
    const snapshot = DayItinerarySnapshotSchema.parse(rawSnapshot);
    const signals = rawSignals;
    if (!snapshot.origin || snapshot.stops.length === 0) {
      return DayItinerarySnapshotSchema.parse({
        ...snapshot,
        signals,
        legs: [],
        updatedAt: timestamp(),
      });
    }

    const points = [
      { id: "origin", point: snapshot.origin },
      ...snapshot.stops.map((stop) => ({ id: stop.id, point: stop.location })),
      ...(snapshot.returnHome ? [{ id: "home", point: snapshot.origin }] : []),
    ];
    const legs: TravelLeg[] = [];
    for (let index = 1; index < points.length; index += 1) {
      const from = points[index - 1];
      const to = points[index];
      if (!from || !to) continue;
      const routePlan = await this.routePlanner.plan(
        RouteRequestSchema.parse({
          origin: from.point,
          destination: to.point,
          profiles: snapshot.profiles,
          maxExtraMinutes: 20,
          bikeStations: [],
        }),
        signals,
      );
      if (routePlan.status === "ok") {
        legs.push(
          TravelLegSchema.parse({
            id: legId(from.id, to.id),
            fromStopId: from.id,
            toStopId: to.id,
            status: snapshot.status === "active" && index === 1 ? "active" : "planned",
            route: routePlan.selected,
            checkedAt: timestamp(),
            evidenceIds: routePlan.evidenceIds,
          }),
        );
      } else {
        legs.push(
          TravelLegSchema.parse({
            id: legId(from.id, to.id),
            fromStopId: from.id,
            toStopId: to.id,
            status: "blocked",
            ...(routePlan.baseline ? { route: routePlan.baseline } : {}),
            reason: routePlan.reason,
            checkedAt: timestamp(),
            evidenceIds: routePlan.evidenceIds,
          }),
        );
      }
    }
    return DayItinerarySnapshotSchema.parse({
      ...snapshot,
      signals,
      legs,
      stops: updateTimeReviews(snapshot, legs),
      updatedAt: timestamp(),
    });
  }

  static hasChanged(before: DayItinerarySnapshot, after: DayItinerarySnapshot): string[] {
    return after.legs
      .filter((leg) => {
        const previous = before.legs.find((candidate) => candidate.id === leg.id);
        return (
          !previous ||
          previous.status !== leg.status ||
          previous.route?.id !== leg.route?.id ||
          previous.route?.durationSeconds !== leg.route?.durationSeconds
        );
      })
      .map((leg) => leg.id);
  }

  static affectedStopIds(snapshot: DayItinerarySnapshot, legIds: string[]): string[] {
    return [
      ...new Set(
        snapshot.legs
          .filter((leg) => legIds.includes(leg.id))
          .flatMap((leg) => [leg.fromStopId, leg.toStopId])
          .filter((id) => id !== "origin" && id !== "home"),
      ),
    ];
  }

  static routeReasons(snapshot: DayItinerarySnapshot, legIds: string[]): string[] {
    return snapshot.legs
      .filter((leg) => legIds.includes(leg.id) && leg.status === "blocked")
      .map((leg) => (leg.status === "blocked" ? leg.reason : "route_changed"));
  }
}
