import { describe, expect, it } from "vitest";
import {
  DayItineraryListResponseSchema,
  DayItineraryResponseSchema,
  DeleteDayItineraryResponseSchema,
  LiveDayItineraryResponseSchema,
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
import { createLiveRefreshHandler } from "../src/app/api/day-plans/[id]/refresh/live/route";
import { createNotificationsHandler } from "../src/app/api/day-plans/[id]/notifications/route";
import { FixtureItineraryAgent } from "../src/lib/conversation/fixtures";
import { FixtureGoogleRoutesProvider } from "../src/lib/routing/fixtures";
import { RoutePlanner } from "../src/lib/routing/planner";
import { DayItineraryPlanner } from "../src/lib/itinerary/planner";
import { ItineraryOrchestrator } from "../src/lib/itinerary/orchestrator";
import { ItineraryStore } from "../src/lib/itinerary/store";
import { todayInTaipei } from "../src/lib/date";

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
  transitSteps: [],
  provider: "google" as const,
};
const transit = { ...direct, id: "transit", profile: "transit" as const };
const today = todayInTaipei();

class AgentThatRejectsStart extends FixtureItineraryAgent {
  override async interpret(
    itinerary: Parameters<FixtureItineraryAgent["interpret"]>[0],
    userMessage: string,
  ) {
    if (userMessage === "開始行程") throw new Error("開始行程不應交給對話 Agent");
    return super.interpret(itinerary, userMessage);
  }
}

function service(agent: FixtureItineraryAgent = new FixtureItineraryAgent()) {
  return new ItineraryOrchestrator(
    new ItineraryStore(":memory:"),
    agent,
    new DayItineraryPlanner(
      new RoutePlanner(
        new FixtureGoogleRoutesProvider([
          {
            profile: "car",
            normal: [direct],
            rerouted: [{ ...direct, id: "detour", durationSeconds: 1200 }],
          },
          {
            profile: "transit",
            normal: [transit],
            rerouted: [
              {
                ...transit,
                id: "transit-detour",
                coordinates: [
                  { latitude: 25.0478, longitude: 121.517 },
                  { latitude: 25.06, longitude: 121.53 },
                  { latitude: 25.0515, longitude: 121.5493 },
                ],
                durationSeconds: 1200,
              },
            ],
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

async function sendMessage(orchestrator: ItineraryOrchestrator, id: string, message: string) {
  return DayItineraryResponseSchema.parse(
    await (
      await createMessageHandler(orchestrator)(
        await postJson(`http://localhost/api/day-plans/${id}/messages`, { message }),
        { params: Promise.resolve({ id }) },
      )
    ).json(),
  );
}

async function planConcert(orchestrator: ItineraryOrchestrator, id: string) {
  await sendMessage(orchestrator, id, "我今天想去聽演唱會");
  await sendMessage(orchestrator, id, "從台北車站出發，10點出門，搭大眾運輸，晚上十點前回家。");
  return sendMessage(orchestrator, id, "確認，就這樣安排");
}

describe("day itinerary API", () => {
  it("supports a blank day and a vague multi-turn planning request", async () => {
    const orchestrator = service();
    const created = DayItineraryResponseSchema.parse(
      await (
        await createPostHandler(orchestrator)(
          await postJson("http://localhost/api/day-plans", {
            userId: "vague-planner",
            date: today,
          }),
        )
      ).json(),
    );
    const id = created.itinerary.id;

    const vague = DayItineraryResponseSchema.parse(
      await (
        await createMessageHandler(orchestrator)(
          await postJson(`http://localhost/api/day-plans/${id}/messages`, {
            message: "想在台北輕鬆走走，下午看展，晚上吃飯，不要排太滿。",
          }),
          { params: Promise.resolve({ id }) },
        )
      ).json(),
    );
    expect(vague.itinerary.status).toBe("discussing");
    expect(vague.itinerary.stops).toHaveLength(0);

    const planned = DayItineraryResponseSchema.parse(
      await (
        await createMessageHandler(orchestrator)(
          await postJson(`http://localhost/api/day-plans/${id}/messages`, {
            message: "從台北車站出發，照剛才的想法安排，晚上回到台北車站。",
          }),
          { params: Promise.resolve({ id }) },
        )
      ).json(),
    );
    expect(planned.itinerary.status).toBe("discussing");
    const confirmed = await sendMessage(orchestrator, id, "確認，這樣安排沒問題");
    expect(confirmed.itinerary.status).toBe("ready");
    expect(confirmed.itinerary.stops).toHaveLength(2);
    expect(confirmed.itinerary.legs).toHaveLength(3);
    expect(confirmed.assistantMessage).toContain("需求已確認");
  });

  it("creates a blank permanent user session", async () => {
    const response = await createPostHandler(service())(
      await postJson("http://localhost/api/day-plans", {
        userId: "user-1",
        date: today,
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
            date: today,
          }),
        )
      ).json(),
    );
    const id = created.itinerary.id;
    const proposed = await planConcert(orchestrator, id);
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

    const live = LiveDayItineraryResponseSchema.parse(
      await (
        await createLiveRefreshHandler(orchestrator)(
          await postJson(`http://localhost/api/day-plans/${id}/refresh/live`, {
            city: "Taipei",
          }),
          { params: Promise.resolve({ id }) },
        )
      ).json(),
    );
    expect(live.cityFeeds.city).toBe("Taipei");
    expect(live.cityFeeds.feeds).toHaveLength(4);

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
    expect(refreshed.notification?.message).toContain("淹水區");
    expect(refreshed.notification?.changes[0]?.before.routeId).toBe("transit");
    expect(
      refreshed.notification?.changes.some(
        (change) =>
          change.after.routeId !== change.before.routeId ||
          change.after.status !== change.before.status,
      ),
    ).toBe(true);
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

  it("starts multiple same-day ready plans without asking the agent to interpret start", async () => {
    const orchestrator = service(new AgentThatRejectsStart());
    const first = orchestrator.createSession("same-day-user", today);
    const second = orchestrator.createSession("same-day-user", today);
    await planConcert(orchestrator, first.id);
    await planConcert(orchestrator, second.id);

    for (const id of [first.id, second.id]) {
      const response = await createStartHandler(orchestrator)(
        new Request(`http://localhost/api/day-plans/${id}/start`),
        { params: Promise.resolve({ id }) },
      );
      expect(response.status).toBe(200);
      expect(DayItineraryResponseSchema.parse(await response.json()).itinerary.status).toBe(
        "active",
      );
    }
  });

  it("lists, restores, demos, completes, and deletes a local day plan", async () => {
    const orchestrator = service();
    const created = DayItineraryResponseSchema.parse(
      await (
        await createPostHandler(orchestrator)(
          await postJson("http://localhost/api/day-plans", {
            userId: "local-demo-user",
            date: today,
          }),
        )
      ).json(),
    );
    const id = created.itinerary.id;
    await planConcert(orchestrator, id);
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
    expect(detail.runs).toHaveLength(3);

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
