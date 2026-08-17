import {
  DayItinerarySnapshotSchema,
  ItineraryTimestampSchema,
  TravelLegSchema,
  RouteRequestSchema,
  type DayItinerarySnapshot,
  type ItineraryStop,
  ItineraryRouteChangeSchema,
  type RouteSignal,
  type TravelLeg,
  type ItineraryRouteChange,
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
      // ponytail: one preferred Google/GraphHopper profile per leg keeps the MVP within API quotas;
      // add per-leg multimodal fallback when transit gateways are integrated.
      const profile = snapshot.profiles[0] ?? "car";
      const previousLeg = snapshot.legs.find(
        (leg) => leg.fromStopId === from.id && leg.toStopId === to.id,
      );
      const routePlan = await this.routePlanner.plan(
        RouteRequestSchema.parse({
          origin: from.point,
          destination: to.point,
          profiles: [profile],
          maxExtraMinutes: 20,
          bikeStations: [],
        }),
        signals,
        signals.length && previousLeg?.route ? previousLeg.route : undefined,
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

  static routeChanges(
    before: DayItinerarySnapshot,
    after: DayItinerarySnapshot,
    legIds: string[],
    signals: RouteSignal[],
  ): ItineraryRouteChange[] {
    const label = (snapshot: DayItinerarySnapshot, stopId: string): string => {
      if (stopId === "origin" || stopId === "home") return snapshot.origin?.label ?? "出發地";
      return snapshot.stops.find((stop) => stop.id === stopId)?.title ?? stopId;
    };
    const state = (leg: TravelLeg) => ({
      status: leg.status,
      ...(leg.route
        ? {
            provider: leg.route.provider,
            profile: leg.route.profile,
            routeId: leg.route.id,
            durationSeconds: leg.route.durationSeconds,
            distanceMeters: leg.route.distanceMeters,
          }
        : {}),
      ...(leg.status === "blocked" ? { reason: leg.reason } : {}),
    });
    const signalReason = signals.map((signal) => `${signal.label}：${signal.summary}`).join("；");

    return legIds.flatMap((legId) => {
      const previous = before.legs.find((leg) => leg.id === legId);
      const next = after.legs.find((leg) => leg.id === legId);
      if (!previous || !next) return [];
      const beforeDuration = previous.route?.durationSeconds ?? 0;
      const afterDuration = next.route?.durationSeconds ?? 0;
      const durationDelta = afterDuration - beforeDuration;
      const tradeoffs = [
        previous.route?.provider !== next.route?.provider
          ? `路線服務由 ${previous.route?.provider ?? "原方案"} 改為 ${next.route?.provider ?? "不可用"}`
          : undefined,
        durationDelta > 0 ? `預估增加 ${Math.ceil(durationDelta / 60)} 分鐘` : undefined,
        durationDelta < 0 ? `預估減少 ${Math.ceil(Math.abs(durationDelta) / 60)} 分鐘` : undefined,
        next.status === "blocked" ? "目前沒有可驗證的替代路線" : undefined,
      ].filter((value): value is string => Boolean(value));
      return [
        ItineraryRouteChangeSchema.parse({
          legId,
          fromStopId: previous.fromStopId,
          toStopId: previous.toStopId,
          fromLabel: label(before, previous.fromStopId),
          toLabel: label(before, previous.toStopId),
          before: state(previous),
          after: state(next),
          delta: {
            durationSeconds: durationDelta,
            distanceMeters:
              (next.route?.distanceMeters ?? 0) - (previous.route?.distanceMeters ?? 0),
          },
          reason: signalReason || (next.status === "blocked" ? next.reason : "路線狀態變更"),
          tradeoffs,
        }),
      ];
    });
  }
}
