import { describe, expect, it } from "vitest";
import {
  DayItineraryListResponseSchema,
  DayItineraryResponseSchema,
  DeleteDayItineraryResponseSchema,
  NotificationListResponseSchema,
} from "../src/contracts";
import { createGetHandler, createPostHandler } from "../src/app/api/day-plans/route";
import { createCompleteHandler } from "../src/app/api/day-plans/[id]/complete/route";
import { createDeleteHandler } from "../src/app/api/day-plans/[id]/delete/route";
import { createDemoHandler } from "../src/app/api/day-plans/[id]/demo/route";
import { createGetHandler as createDetailGetHandler } from "../src/app/api/day-plans/[id]/route";
import { createMessageHandler } from "../src/app/api/day-plans/[id]/messages/route";
import { createStartHandler } from "../src/app/api/day-plans/[id]/start/route";
import { createRefreshHandler } from "../src/app/api/day-plans/[id]/refresh/route";
import { createNotificationsHandler } from "../src/app/api/day-plans/[id]/notifications/route";
import { FixtureItineraryAgent } from "../src/lib/conversation/fixtures";
import { FixtureGraphHopperProvider } from "../src/lib/routing/fixtures";
import { RoutePlanner } from "../src/lib/routing/planner";
import { DayItineraryPlanner } from "../src/lib/itinerary/planner";
import { ItineraryOrchestrator } from "../src/lib/itinerary/orchestrator";
import { ItineraryStore } from "../src/lib/itinerary/store";

const direct = {
  id: "direct",
  profile: "car" as const,
  coordinates: [
    { latitude: 25.0478, longitude: 121.517 },
    { latitude: 25.0515, longitude: 121.5493 },
  ],
  distanceMeters: 3000,
  durationSeconds: 900,
  stationIds: [],
  instructions: [],
  provider: "graphhopper" as const,
};

function service() {
  return new ItineraryOrchestrator(
    new ItineraryStore(":memory:"),
    new FixtureItineraryAgent(),
    new DayItineraryPlanner(
      new RoutePlanner(
        new FixtureGraphHopperProvider([
          {
            profile: "car",
            normal: [direct],
            rerouted: [{ ...direct, id: "detour", durationSeconds: 1200 }],
          },
          {
            profile: "bike",
            normal: [direct],
            rerouted: [{ ...direct, id: "bike-detour", durationSeconds: 1100 }],
          },
          {
            profile: "foot",
            normal: [direct],
            rerouted: [{ ...direct, id: "foot-detour", durationSeconds: 1300 }],
          },
        ]),
      ),
    ),
  );
}

async function postJson(url: string, body: object): Promise<Request> {
  return new Request(url, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

describe("day itinerary API", () => {
  it("creates a blank permanent user session", async () => {
    const response = await createPostHandler(service())(
      await postJson("http://localhost/api/day-plans", {
        userId: "user-1",
        date: "2026-08-17",
      }),
    );
    expect(response.status).toBe(200);
    const body = DayItineraryResponseSchema.parse(await response.json());
    expect(body.itinerary.status).toBe("discussing");
  });

  it("creates through messages, starts, refreshes, and returns notifications", async () => {
    const orchestrator = service();
    const created = DayItineraryResponseSchema.parse(
      await (
        await createPostHandler(orchestrator)(
          await postJson("http://localhost/api/day-plans", {
            userId: "user-1",
            date: "2026-08-17",
          }),
        )
      ).json(),
    );
    const id = created.itinerary.id;
    const proposed = DayItineraryResponseSchema.parse(
      await (
        await createMessageHandler(orchestrator)(
          await postJson(`http://localhost/api/day-plans/${id}/messages`, {
            message: "我今天想去聽演唱會",
          }),
          { params: Promise.resolve({ id }) },
        )
      ).json(),
    );
    expect(proposed.itinerary.stops.length).toBeGreaterThan(0);
    const started = DayItineraryResponseSchema.parse(
      await (
        await createStartHandler(orchestrator)(
          new Request(`http://localhost/api/day-plans/${id}/start`),
          {
            params: Promise.resolve({ id }),
          },
        )
      ).json(),
    );
    expect(started.itinerary.status).toBe("active");

    const refreshed = DayItineraryResponseSchema.parse(
      await (
        await createRefreshHandler(orchestrator)(
          await postJson(`http://localhost/api/day-plans/${id}/refresh`, {
            signals: [
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
            ],
          }),
          { params: Promise.resolve({ id }) },
        )
      ).json(),
    );
    expect(refreshed.notification?.message).toContain("路線");
    const notifications = NotificationListResponseSchema.parse(
      await (
        await createNotificationsHandler(orchestrator)(
          new Request(`http://localhost/api/day-plans/${id}/notifications`),
          {
            params: Promise.resolve({ id }),
          },
        )
      ).json(),
    );
    expect(notifications.notifications).toHaveLength(1);
  });

  it("lists, restores, demos, completes, and deletes a local day plan", async () => {
    const orchestrator = service();
    const created = DayItineraryResponseSchema.parse(
      await (
        await createPostHandler(orchestrator)(
          await postJson("http://localhost/api/day-plans", {
            userId: "local-demo-user",
            date: "2026-08-17",
          }),
        )
      ).json(),
    );
    const id = created.itinerary.id;
    await createMessageHandler(orchestrator)(
      await postJson(`http://localhost/api/day-plans/${id}/messages`, {
        message: "我今天想去聽演唱會",
      }),
      { params: Promise.resolve({ id }) },
    );
    const detail = DayItineraryResponseSchema.parse(
      await (
        await createDetailGetHandler(orchestrator)(
          new Request(`http://localhost/api/day-plans/${id}`),
          {
            params: Promise.resolve({ id }),
          },
        )
      ).json(),
    );
    expect(detail.runs).toHaveLength(1);

    await createStartHandler(orchestrator)(new Request("http://localhost/api/day-plans/start"), {
      params: Promise.resolve({ id }),
    });
    const demo = DayItineraryResponseSchema.parse(
      await (
        await createDemoHandler(orchestrator)(
          await postJson(`http://localhost/api/day-plans/${id}/demo`, { scenario: "flood" }),
          { params: Promise.resolve({ id }) },
        )
      ).json(),
    );
    expect(demo.notification?.kind).toBe("service_disruption");

    const completed = DayItineraryResponseSchema.parse(
      await (
        await createCompleteHandler(orchestrator)(
          new Request("http://localhost/api/day-plans/complete"),
          {
            params: Promise.resolve({ id }),
          },
        )
      ).json(),
    );
    expect(completed.itinerary.status).toBe("completed");

    const listed = DayItineraryListResponseSchema.parse(
      await (
        await createGetHandler(orchestrator)(
          new Request("http://localhost/api/day-plans?userId=local-demo-user"),
        )
      ).json(),
    );
    expect(listed.itineraries[0]?.status).toBe("completed");
    const deleted = DeleteDayItineraryResponseSchema.parse(
      await (
        await createDeleteHandler(orchestrator)(
          new Request(`http://localhost/api/day-plans/${id}/delete`, { method: "DELETE" }),
          {
            params: Promise.resolve({ id }),
          },
        )
      ).json(),
    );
    expect(deleted.deleted).toBe(true);
    const afterDelete = DayItineraryListResponseSchema.parse(
      await (
        await createGetHandler(orchestrator)(
          new Request("http://localhost/api/day-plans?userId=local-demo-user"),
        )
      ).json(),
    );
    expect(afterDelete.itineraries).toHaveLength(0);
  });
});
