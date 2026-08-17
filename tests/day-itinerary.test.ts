import { describe, expect, it } from "vitest";
import { RoutePathSchema } from "../src/contracts";
import { FixtureItineraryAgent } from "../src/lib/conversation/fixtures";
import { FixtureGraphHopperProvider } from "../src/lib/routing/fixtures";
import { RoutePlanner } from "../src/lib/routing/planner";
import { DayItineraryPlanner } from "../src/lib/itinerary/planner";
import { ItineraryOrchestrator } from "../src/lib/itinerary/orchestrator";
import { ItineraryStore } from "../src/lib/itinerary/store";

const direct = RoutePathSchema.parse({
  id: "direct",
  profile: "car",
  coordinates: [
    { latitude: 25.0478, longitude: 121.517 },
    { latitude: 25.0515, longitude: 121.5493 },
  ],
  distanceMeters: 3000,
  durationSeconds: 900,
  stationIds: [],
  instructions: [],
  provider: "graphhopper",
});
const detour = RoutePathSchema.parse({
  ...direct,
  id: "detour",
  coordinates: [
    { latitude: 25.0478, longitude: 121.517 },
    { latitude: 25.06, longitude: 121.53 },
    { latitude: 25.0515, longitude: 121.5493 },
  ],
  durationSeconds: 1200,
});

function service() {
  return new ItineraryOrchestrator(
    new ItineraryStore(":memory:"),
    new FixtureItineraryAgent(),
    new DayItineraryPlanner(
      new RoutePlanner(
        new FixtureGraphHopperProvider([
          { profile: "car", normal: [direct], rerouted: [detour] },
          { profile: "bike", normal: [direct], rerouted: [detour] },
          { profile: "foot", normal: [direct], rerouted: [detour] },
        ]),
      ),
    ),
  );
}

describe("day itinerary orchestration", () => {
  it("clarifies a vague request before filling a blank day", async () => {
    const orchestrator = service();
    const itinerary = orchestrator.createSession("user-1", "2026-08-17");

    const vague = await orchestrator.sendMessage(
      itinerary.id,
      "這天想在台北輕鬆走走，不要太早出門，下午想看展，晚上吃點東西，最好早點回家。",
    );
    expect(vague.itinerary.status).toBe("discussing");
    expect(vague.itinerary.stops).toHaveLength(0);
    expect(vague.assistantMessage).toContain("從哪裡出發");

    const clarified = await orchestrator.sendMessage(
      itinerary.id,
      "從台北車站出發，照剛才看展和吃飯的想法安排。",
    );
    expect(clarified.itinerary.status).toBe("ready");
    expect(clarified.itinerary.stops.map((stop) => stop.title)).toEqual(["下午看展", "晚餐散步"]);
    expect(clarified.itinerary.legs).toHaveLength(3);
    expect(clarified.itinerary.legs.every((leg) => leg.status !== "blocked")).toBe(true);
  });

  it("builds a concert day through conversation and starts navigation", async () => {
    const orchestrator = service();
    const itinerary = orchestrator.createSession("user-1", "2026-08-17");
    const proposed = await orchestrator.sendMessage(itinerary.id, "我今天想去聽演唱會");
    expect(proposed.itinerary.status).toBe("ready");
    expect(proposed.itinerary.stops).toHaveLength(2);
    expect(proposed.itinerary.legs).toHaveLength(3);

    const started = await orchestrator.sendMessage(itinerary.id, "開始行程");
    expect(started.itinerary.status).toBe("active");
    expect(started.itinerary.currentStopId).toBe(started.itinerary.stops[0]?.id);
  });

  it("refreshes active legs and stores an update notification", async () => {
    const orchestrator = service();
    const itinerary = orchestrator.createSession("user-1", "2026-08-17");
    await orchestrator.sendMessage(itinerary.id, "我今天想去聽演唱會");
    await orchestrator.sendMessage(itinerary.id, "開始行程");
    const refreshed = await orchestrator.refresh(itinerary.id, [
      {
        id: "flood-1",
        kind: "flood_zone",
        label: "淹水區",
        polygon: [
          { latitude: 25.04, longitude: 121.52 },
          { latitude: 25.04, longitude: 121.54 },
          { latitude: 25.05, longitude: 121.54 },
          { latitude: 25.05, longitude: 121.52 },
          { latitude: 25.04, longitude: 121.52 },
        ],
        severity: "blocked",
        observedAt: "2026-08-17T16:00:00+08:00",
        evidenceId: "e-flood",
        summary: "道路積水禁止通行",
      },
    ]);
    expect(refreshed.itinerary.revision).toBe(3);
    expect(refreshed.itinerary.notifications).toHaveLength(1);
    expect(refreshed.notification?.kind).toBe("service_disruption");
    expect(refreshed.notification?.message).toContain("淹水區");
    expect(refreshed.notification?.changes[0]?.before.routeId).toBe("direct");
    expect(refreshed.notification?.changes[0]?.after.routeId).toBe("detour");
    expect(refreshed.notification?.changes[0]?.delta.durationSeconds).toBeGreaterThan(0);
  });

  it("completes the whole day and marks stops and return leg complete", async () => {
    const orchestrator = service();
    const itinerary = orchestrator.createSession("user-1", "2026-08-17");
    await orchestrator.sendMessage(itinerary.id, "我今天想去聽演唱會");
    await orchestrator.sendMessage(itinerary.id, "開始行程");
    const completed = await orchestrator.sendMessage(itinerary.id, "完成行程");
    expect(completed.itinerary.status).toBe("completed");
    expect(completed.itinerary.stops.every((stop) => stop.status === "visited")).toBe(true);
    expect(completed.itinerary.legs.at(-1)?.toStopId).toBe("home");
  });
});
