import { describe, expect, it } from "vitest";
import {
  CityFeedSnapshotSchema,
  ConversationAgentOutputSchema,
  ConversationAgentResultSchema,
  ItineraryNotificationSchema,
  RoutePathSchema,
  type CityFeedSnapshot,
  type ConversationAgentResult,
  type NotificationAgentInput,
  type NotificationAgentOutput,
  type RouteCalculationInput,
  type RouteProviderResult,
} from "../src/contracts";
import { FixtureItineraryAgent } from "../src/lib/conversation/fixtures";
import { FixtureGoogleRoutesProvider } from "../src/lib/routing/fixtures";
import { DemoRouteProvider } from "../src/lib/routing/demo";
import { demoSignal } from "../src/lib/itinerary/demo";
import { RoutePlanner, type RouteProvider } from "../src/lib/routing/planner";
import { DayItineraryPlanner } from "../src/lib/itinerary/planner";
import { ItineraryOrchestrator } from "../src/lib/itinerary/orchestrator";
import { ItineraryStore } from "../src/lib/itinerary/store";
import { CityDataGateway } from "../src/lib/city/gateway";
import { todayInTaipei } from "../src/lib/date";

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
  provider: "google",
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
const today = todayInTaipei();
const transit = RoutePathSchema.parse({ ...direct, id: "transit", profile: "transit" });
const transitDetour = RoutePathSchema.parse({
  ...detour,
  id: "transit-detour",
  profile: "transit",
});

class ConfirmationFixtureItineraryAgent extends FixtureItineraryAgent {
  override async interpret(
    itinerary: Parameters<FixtureItineraryAgent["interpret"]>[0],
    userMessage: string,
  ): Promise<ConversationAgentResult> {
    if (userMessage.includes("接受")) {
      const notification = itinerary.notifications.at(-1);
      if (!notification) throw new Error("fixture 缺少可確認通知");
      return ConversationAgentResultSchema.parse({
        output: ConversationAgentOutputSchema.parse({
          message: "已接受路線更新，繼續執行行程。",
          planningPhase: "refining",
          planningStatus: "ready",
          facts: itinerary.planningFacts,
          command: { action: "ack_notification", notificationId: notification.id },
        }),
        interactionId: `fixture-ack-${itinerary.id}`,
      });
    }
    return super.interpret(itinerary, userMessage);
  }

  override async draftNotification(
    input: NotificationAgentInput,
  ): Promise<NotificationAgentOutput> {
    return ItineraryNotificationSchema.parse({
      ...(await super.draftNotification(input)),
      requiresConfirmation: true,
    });
  }
}

class FixtureAgentWithoutConstraints extends FixtureItineraryAgent {
  override async interpret(
    itinerary: Parameters<FixtureItineraryAgent["interpret"]>[0],
    userMessage: string,
  ): Promise<ConversationAgentResult> {
    const result = await super.interpret(itinerary, userMessage);
    return ConversationAgentResultSchema.parse({
      ...result,
      output: ConversationAgentOutputSchema.parse({
        ...result.output,
        facts: { ...result.output.facts, constraints: { status: "missing" } },
      }),
    });
  }
}

class FixtureAgentWithoutFixedActivities extends FixtureItineraryAgent {
  override async interpret(
    itinerary: Parameters<FixtureItineraryAgent["interpret"]>[0],
    userMessage: string,
  ): Promise<ConversationAgentResult> {
    const result = await super.interpret(itinerary, userMessage);
    return ConversationAgentResultSchema.parse({
      ...result,
      output: ConversationAgentOutputSchema.parse({
        ...result.output,
        facts: { ...result.output.facts, fixedActivities: { status: "missing" } },
      }),
    });
  }
}

class EmptyCityGateway extends CityDataGateway {
  override async refresh(): Promise<CityFeedSnapshot> {
    return CityFeedSnapshotSchema.parse({
      city: "Taipei",
      checkedAt: "2026-08-17T16:00:00+08:00",
      feeds: [],
      observations: [],
      signals: [],
    });
  }
}

class CountingRouteProvider implements RouteProvider {
  calls = 0;

  constructor(private readonly delegate: FixtureGoogleRoutesProvider) {}

  calculate(input: RouteCalculationInput): Promise<RouteProviderResult> {
    this.calls += 1;
    return this.delegate.calculate(input);
  }
}

class BlockedFirstStopProvider implements RouteProvider {
  async calculate(input: RouteCalculationInput): Promise<RouteProviderResult> {
    const blocked =
      input.blockedSignals.length && input.request.destination.label === "華山文創園區";
    return {
      status: "ok",
      paths: [input.blockedSignals.length ? (blocked ? transit : transitDetour) : transit],
    };
  }
}

class UnavailableRouteProvider implements RouteProvider {
  async calculate(): Promise<RouteProviderResult> {
    return { status: "unavailable", reason: "沒有可用路線" };
  }
}

function service(
  agent: FixtureItineraryAgent = new FixtureItineraryAgent(),
  provider: RouteProvider = new FixtureGoogleRoutesProvider([
    { profile: "car", normal: [direct], rerouted: [detour] },
    { profile: "transit", normal: [transit], rerouted: [transitDetour] },
    { profile: "bike", normal: [direct], rerouted: [detour] },
    { profile: "foot", normal: [direct], rerouted: [detour] },
  ]),
  cityGateway?: CityDataGateway,
) {
  return new ItineraryOrchestrator(
    new ItineraryStore(":memory:"),
    agent,
    new DayItineraryPlanner(new RoutePlanner(provider)),
    cityGateway,
  );
}

async function planConcert(
  orchestrator: ItineraryOrchestrator,
  itinerary: ReturnType<ItineraryOrchestrator["createSession"]>,
) {
  await orchestrator.sendMessage(itinerary.id, "我今天想去聽演唱會");
  await orchestrator.sendMessage(
    itinerary.id,
    "從台北車站出發，10點出門，搭大眾運輸，晚上十點前回家。",
  );
  return orchestrator.sendMessage(itinerary.id, "確認，就這樣安排");
}

describe("day itinerary orchestration", () => {
  it("can schedule a confirmed plan when constraints were omitted", async () => {
    const orchestrator = service(new FixtureAgentWithoutConstraints());
    const itinerary = orchestrator.createSession("user-1", today);
    const proposed = await planConcert(orchestrator, itinerary);

    expect(proposed.itinerary.status).toBe("ready");
    expect(proposed.itinerary.stops).toHaveLength(2);
  });

  it("can schedule a confirmed plan when fixed activities were omitted", async () => {
    const orchestrator = service(new FixtureAgentWithoutFixedActivities());
    const itinerary = orchestrator.createSession("user-1", today);
    const proposed = await planConcert(orchestrator, itinerary);

    expect(proposed.itinerary.status).toBe("ready");
    expect(proposed.itinerary.stops).toHaveLength(2);
  });

  it("clarifies a vague request before filling a blank day", async () => {
    const orchestrator = service();
    const itinerary = orchestrator.createSession("user-1", today);

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
    expect(clarified.itinerary.status).toBe("discussing");
    expect(clarified.itinerary.planningPhase).toBe("awaiting_confirmation");

    const confirmed = await orchestrator.sendMessage(itinerary.id, "確認，這樣安排沒問題");
    expect(confirmed.itinerary.status).toBe("ready");
    expect(confirmed.itinerary.stops.map((stop) => stop.title)).toEqual(["下午看展", "晚餐散步"]);
    expect(confirmed.itinerary.legs).toHaveLength(3);
    expect(confirmed.itinerary.legs.every((leg) => leg.status !== "blocked")).toBe(true);
  });

  it("builds a concert day through conversation and starts navigation", async () => {
    const orchestrator = service();
    const itinerary = orchestrator.createSession("user-1", today);
    const proposed = await planConcert(orchestrator, itinerary);
    expect(proposed.itinerary.status).toBe("ready");
    expect(proposed.itinerary.stops).toHaveLength(2);
    expect(proposed.itinerary.legs).toHaveLength(3);
    expect(proposed.itinerary.legs.every((leg) => leg.route?.profile === "transit")).toBe(true);

    const started = await orchestrator.sendMessage(itinerary.id, "開始行程");
    expect(started.itinerary.status).toBe("active");
    expect(started.itinerary.currentStopId).toBe(started.itinerary.stops[0]?.id);
  });

  it("allows the judge demo to start a scheduled plan", async () => {
    const orchestrator = service();
    const itinerary = orchestrator.createSession("user-1", "2099-01-01");
    const proposed = await planConcert(orchestrator, itinerary);

    expect(proposed.itinerary.status).toBe("ready");
    const started = await orchestrator.startNavigation(itinerary.id, "system:judge_demo:start");
    expect(started.itinerary.status).toBe("active");
  });

  it("keeps an initially unroutable plan in conversation", async () => {
    const orchestrator = service(new FixtureItineraryAgent(), new UnavailableRouteProvider());
    const itinerary = orchestrator.createSession("user-1", today);

    const proposed = await planConcert(orchestrator, itinerary);

    expect(proposed.itinerary.status).toBe("discussing");
    expect(proposed.itinerary.legs.some((leg) => leg.status === "blocked")).toBe(true);
    expect(proposed.notification?.message).toContain("其他景點");
  });

  it("routes the return leg to the confirmed return location", async () => {
    const orchestrator = service();
    const itinerary = orchestrator.createSession("user-1", today);
    const proposed = await planConcert(orchestrator, itinerary);
    const hotel = {
      label: "駁二附近飯店",
      coordinate: { latitude: 22.619, longitude: 120.2818 },
    };
    const replanned = await new DayItineraryPlanner(
      new RoutePlanner(new DemoRouteProvider()),
    ).rebuild(
      {
        ...proposed.itinerary,
        planningFacts: {
          ...proposed.itinerary.planningFacts,
          returnPlan: {
            status: "confirmed",
            value: { returnHome: true, location: hotel },
          },
        },
      },
      [],
    );

    expect(replanned.legs.at(-1)?.route?.coordinates.at(-1)).toEqual(hotel.coordinate);
  });

  it("refreshes active legs and stores an update notification", async () => {
    const orchestrator = service();
    const itinerary = orchestrator.createSession("user-1", today);
    await planConcert(orchestrator, itinerary);
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
    expect(refreshed.itinerary.revision).toBe(5);
    expect(refreshed.itinerary.notifications).toHaveLength(1);
    expect(refreshed.notification?.kind).toBe("service_disruption");
    expect(refreshed.notification?.message).toContain("淹水區");
    expect(refreshed.notification?.changes[0]?.before.routeId).toBe("transit");
    expect(refreshed.notification?.changes[0]?.after.routeId).toBe("transit-detour");
    expect(refreshed.notification?.changes[0]?.delta.durationSeconds).toBeGreaterThan(0);
  });

  it("resumes active navigation after acknowledging a safe route update", async () => {
    const orchestrator = service(new ConfirmationFixtureItineraryAgent());
    const itinerary = orchestrator.createSession("user-1", today);
    await planConcert(orchestrator, itinerary);
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
    expect(refreshed.itinerary.status).toBe("update_pending");
    expect(refreshed.itinerary.legs.every((leg) => leg.status !== "blocked")).toBe(true);

    const acknowledged = await orchestrator.sendMessage(itinerary.id, "我接受這次路線更新");
    expect(acknowledged.itinerary.status).toBe("active");
    expect(acknowledged.itinerary.notifications[0]?.readAt).toBeDefined();
  });

  it("asks for another destination and replaces a blocked stop", async () => {
    const orchestrator = service(
      new ConfirmationFixtureItineraryAgent(),
      new BlockedFirstStopProvider(),
    );
    const itinerary = orchestrator.createSession("user-1", today);
    await planConcert(orchestrator, itinerary);
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

    expect(refreshed.itinerary.legs.some((leg) => leg.status === "blocked")).toBe(true);
    expect(refreshed.notification?.message).toContain("其他景點");
    expect(refreshed.notification?.requiresConfirmation).toBe(false);
    expect(refreshed.itinerary.status).toBe("active");

    const replaced = await orchestrator.sendMessage(itinerary.id, "改去替代景點");
    expect(replaced.itinerary.stops[0]?.title).toBe("替代景點");
    expect(replaced.itinerary.legs.every((leg) => leg.status !== "blocked")).toBe(true);
  });

  it("does not rebuild routes when live feeds have no actionable signals", async () => {
    const provider = new CountingRouteProvider(
      new FixtureGoogleRoutesProvider([
        { profile: "car", normal: [direct], rerouted: [detour] },
        { profile: "transit", normal: [transit], rerouted: [transitDetour] },
        { profile: "bike", normal: [direct], rerouted: [detour] },
        { profile: "foot", normal: [direct], rerouted: [detour] },
      ]),
    );
    const orchestrator = service(new FixtureItineraryAgent(), provider, new EmptyCityGateway());
    const itinerary = orchestrator.createSession("user-1", today);
    await planConcert(orchestrator, itinerary);
    await orchestrator.sendMessage(itinerary.id, "開始行程");
    const before = orchestrator.getSession(itinerary.id);
    if (!before) throw new Error("fixture session 不存在");
    const callsBefore = provider.calls;

    const live = await orchestrator.refreshLive(itinerary.id, { city: "Taipei" });

    expect(live.lastRun.status).toBe("succeeded");
    expect(live.itinerary.revision).toBe(before.revision);
    expect(provider.calls).toBe(callsBefore);
    expect(live.cityFeeds.signals).toHaveLength(0);
  });

  it("completes the whole day and marks stops and return leg complete", async () => {
    const orchestrator = service();
    const itinerary = orchestrator.createSession("user-1", today);
    await planConcert(orchestrator, itinerary);
    await orchestrator.sendMessage(itinerary.id, "開始行程");
    const completed = await orchestrator.sendMessage(itinerary.id, "完成行程");
    expect(completed.itinerary.status).toBe("completed");
    expect(completed.itinerary.stops.every((stop) => stop.status === "visited")).toBe(true);
    expect(completed.itinerary.legs.at(-1)?.toStopId).toBe("home");
  });

  it("runs every local demo event from start through completion", async () => {
    const scenarios = ["flood", "road_closure", "station_disruption", "bike_unavailable"] as const;
    for (const scenario of scenarios) {
      const orchestrator = service(new FixtureItineraryAgent(), new DemoRouteProvider());
      const itinerary = orchestrator.createSession("demo-user", today);
      await planConcert(orchestrator, itinerary);
      await orchestrator.sendMessage(itinerary.id, "開始行程");

      const refreshed = await orchestrator.demoRefresh(itinerary.id, scenario);
      expect(refreshed.lastRun.status, scenario).toBe("succeeded");
      expect(refreshed.notification, scenario).toBeDefined();

      const completed = await orchestrator.sendMessage(itinerary.id, "完成行程");
      expect(completed.itinerary.status, scenario).toBe("completed");
      expect(completed.itinerary.stops.every((stop) => stop.status === "visited")).toBe(true);
    }
  });

  it("includes a visible mode in demo transit routes", async () => {
    const result = await new DemoRouteProvider().calculate({
      request: {
        origin: { label: "台北車站", coordinate: { latitude: 25.0478, longitude: 121.517 } },
        destination: {
          label: "台北小巨蛋",
          coordinate: { latitude: 25.0515, longitude: 121.5493 },
        },
        profiles: ["transit"],
        maxExtraMinutes: 20,
        bikeStations: [],
      },
      profile: "transit",
      blockedSignals: [],
    });

    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.paths[0]?.transitSteps[0]).toMatchObject({
        mode: "metro",
        lineColor: "#e3002c",
        lineTextColor: "#ffffff",
        boardingStop: { name: "台北車站" },
        alightingStop: { name: "台北小巨蛋" },
      });
    }
  });

  it("keeps a visible transit mode when demo refresh preserves a safe baseline", async () => {
    const baseline = RoutePathSchema.parse({
      ...direct,
      id: "demo-transit-direct",
      profile: "transit",
      transitSteps: [],
    });
    const unrelatedRoute = RoutePathSchema.parse({
      ...baseline,
      id: "unrelated-route",
      coordinates: [
        { latitude: 25.1, longitude: 121.4 },
        { latitude: 25.12, longitude: 121.42 },
      ],
    });
    const result = await new RoutePlanner(new DemoRouteProvider()).plan(
      {
        origin: { label: "台北車站", coordinate: baseline.coordinates[0] },
        destination: { label: "台北小巨蛋", coordinate: baseline.coordinates[1] },
        profiles: ["transit"],
        maxExtraMinutes: 20,
        bikeStations: [],
      },
      [demoSignal("road_closure", unrelatedRoute)],
      baseline,
    );

    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.selected.id).toBe("demo-transit-direct");
      expect(result.selected.transitSteps[0]?.mode).toBe("metro");
    }
  });

  it("moves a demo incident onto the current route when the trip is elsewhere", async () => {
    const route = RoutePathSchema.parse({
      ...direct,
      coordinates: [
        { latitude: 25.1, longitude: 121.4 },
        { latitude: 25.12, longitude: 121.42 },
      ],
    });
    const planner = new RoutePlanner(new DemoRouteProvider());
    const result = await planner.plan(
      {
        origin: { label: "A", coordinate: route.coordinates[0] },
        destination: { label: "B", coordinate: route.coordinates[1] },
        profiles: ["car"],
        maxExtraMinutes: 20,
        bikeStations: [],
      },
      [demoSignal("road_closure", route)],
      route,
    );

    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.rerouted).toBe(true);
      expect(result.selected.id).toBe("demo-car-detour");
    }
  });
});
