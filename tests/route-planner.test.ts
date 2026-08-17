import { describe, expect, it } from "vitest";
import { RoutePathSchema, RouteRequestSchema, RouteSignalSchema } from "../src/contracts";
import { FixtureGoogleRoutesProvider } from "../src/lib/routing/fixtures";
import { RoutePlanner, type RouteProvider } from "../src/lib/routing/planner";

const origin = { latitude: 25, longitude: 121 };
const destination = { latitude: 25, longitude: 121.02 };
const blockedPolygon = [
  { latitude: 24.998, longitude: 121.006 },
  { latitude: 24.998, longitude: 121.014 },
  { latitude: 25.002, longitude: 121.014 },
  { latitude: 25.002, longitude: 121.006 },
  { latitude: 24.998, longitude: 121.006 },
];

const path = (
  id: string,
  profile: "car" | "bike" | "foot",
  coordinates: typeof blockedPolygon,
  durationSeconds: number,
  stationIds: string[] = [],
) =>
  RoutePathSchema.parse({
    id,
    profile,
    coordinates,
    distanceMeters: durationSeconds * 10,
    durationSeconds,
    stationIds,
    instructions: [],
    provider: "google",
  });

const directCar = path(
  "car-direct",
  "car",
  [origin, { latitude: 25, longitude: 121.01 }, destination],
  100,
  ["mrt-1"],
);
const detourCar = path(
  "car-detour",
  "car",
  [
    origin,
    { latitude: 25.01, longitude: 121.005 },
    { latitude: 25.01, longitude: 121.015 },
    destination,
  ],
  150,
);
const directBike = path(
  "bike-direct",
  "bike",
  [origin, { latitude: 25, longitude: 121.01 }, destination],
  80,
);
const directFoot = path(
  "foot-direct",
  "foot",
  [origin, { latitude: 25.004, longitude: 121.01 }, destination],
  150,
);

const request = (profiles: ("car" | "bike" | "foot")[] = ["car"]) =>
  RouteRequestSchema.parse({
    origin: { label: "A", coordinate: origin },
    destination: { label: "B", coordinate: destination },
    profiles,
    maxExtraMinutes: 20,
    bikeStations: profiles.includes("bike")
      ? [
          { stationId: "bike-origin", role: "origin_pickup" },
          { stationId: "bike-destination", role: "destination_dropoff" },
        ]
      : [],
  });

const signal = (input: object) =>
  RouteSignalSchema.parse({
    id: "signal-1",
    label: "模擬城市事件",
    observedAt: "2026-08-17T08:00:00+08:00",
    evidenceId: "evidence-1",
    summary: "測試事件",
    ...input,
  });

function planner() {
  return new RoutePlanner(
    new FixtureGoogleRoutesProvider([
      { profile: "car", normal: [directCar, detourCar], rerouted: [detourCar] },
      { profile: "bike", normal: [directBike], rerouted: [directBike] },
      { profile: "foot", normal: [directFoot], rerouted: [directFoot] },
    ]),
  );
}

describe("disruption-aware route planner", () => {
  it("keeps the fastest route when there is no disruption", async () => {
    const result = await planner().plan(request(), []);
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.selected.id).toBe("car-direct");
      expect(result.rerouted).toBe(false);
    }
  });

  it("reroutes around a flooded area", async () => {
    const result = await planner().plan(request(), [
      signal({ kind: "flood_zone", polygon: blockedPolygon, severity: "blocked" }),
    ]);
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.baseline.id).toBe("car-direct");
      expect(result.selected.id).toBe("car-detour");
      expect(result.rerouted).toBe(true);
    }
  });

  it("reroutes around a road closure and a closed station", async () => {
    const result = await planner().plan(request(), [
      signal({ kind: "road_closure", polygon: blockedPolygon, severity: "blocked" }),
      signal({
        kind: "station_disruption",
        stationId: "mrt-1",
        polygon: blockedPolygon,
        status: "closed",
      }),
    ]);
    expect(result.status).toBe("ok");
    if (result.status === "ok") expect(result.selected.id).toBe("car-detour");
  });

  it("changes from bike to walking when the origin has no bikes", async () => {
    const result = await planner().plan(request(["bike", "foot"]), [
      signal({
        kind: "bike_station",
        stationId: "bike-origin",
        coordinate: origin,
        availableBikes: 0,
        availableDocks: 10,
      }),
    ]);
    expect(result.status).toBe("ok");
    if (result.status === "ok") expect(result.selected.profile).toBe("foot");
  });

  it("uses another allowed Google mode before returning no_safe_route", async () => {
    const fallbackProvider = new FixtureGoogleRoutesProvider([
      { profile: "car", normal: [directCar], rerouted: [directCar] },
      { profile: "foot", normal: [directFoot], rerouted: [directFoot] },
    ]);
    const result = await new RoutePlanner(fallbackProvider).plan(request(["car", "foot"]), [
      signal({ kind: "road_closure", polygon: blockedPolygon, severity: "blocked" }),
    ]);

    expect(result.status).toBe("ok");
    if (result.status === "ok") expect(result.selected.profile).toBe("foot");
  });

  it("can use a Google reroute when the baseline query is unavailable", async () => {
    const provider: RouteProvider = {
      calculate: async ({ blockedSignals }) =>
        blockedSignals.length
          ? { status: "ok", paths: [detourCar] }
          : { status: "unavailable", reason: "Google baseline 暫時沒有結果" },
    };
    const result = await new RoutePlanner(provider).plan(request(), [
      signal({ kind: "road_closure", polygon: blockedPolygon, severity: "blocked" }),
    ]);

    expect(result.status).toBe("ok");
    if (result.status === "ok") expect(result.selected.id).toBe("car-detour");
  });

  it("does not let an expired city signal veto a current Google route", async () => {
    const result = await planner().plan(request(), [
      signal({
        kind: "flood_zone",
        polygon: blockedPolygon,
        severity: "blocked",
        expiresAt: "2020-01-01T00:00:00+08:00",
      }),
    ]);

    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.selected.id).toBe("car-direct");
      expect(result.signals).toHaveLength(0);
    }
  });

  it("returns no_safe_route when every candidate is blocked", async () => {
    const blockedProvider = new FixtureGoogleRoutesProvider([
      { profile: "car", normal: [directCar], rerouted: [directCar] },
    ]);
    const result = await new RoutePlanner(blockedProvider).plan(request(), [
      signal({ kind: "flood_zone", polygon: blockedPolygon, severity: "blocked" }),
    ]);
    expect(result.status).toBe("no_safe_route");
  });

  it("uses the same Google provider for normal and disruption candidates", async () => {
    const counter = { value: 0 };
    const provider: RouteProvider = {
      calculate: async () => {
        counter.value += 1;
        return { status: "ok", paths: [directCar] };
      },
    };

    await new RoutePlanner(provider).plan(request(), []);
    await new RoutePlanner(provider).plan(request(), [
      signal({ kind: "road_closure", polygon: blockedPolygon, severity: "blocked" }),
    ]);
    expect(counter.value).toBe(3);
  });
});
