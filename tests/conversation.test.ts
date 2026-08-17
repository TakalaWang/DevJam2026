import { describe, expect, it } from "vitest";
import { DayItinerarySnapshotSchema } from "../src/contracts";
import { FixtureItineraryAgent } from "../src/lib/conversation/fixtures";

const emptyItinerary = DayItinerarySnapshotSchema.parse({
  id: "day-1",
  userId: "user-1",
  status: "discussing",
  revision: 0,
  date: "2026-08-17",
  profiles: ["car", "bike", "foot"],
  returnHome: true,
  stops: [],
  legs: [],
  signals: [],
  notifications: [],
  createdAt: "2026-08-17T09:00:00+08:00",
  updatedAt: "2026-08-17T09:00:00+08:00",
});

describe("Gemini conversation contract boundary", () => {
  it("collects and confirms a concert request before proposing a day", async () => {
    const agent = new FixtureItineraryAgent();
    const missing = await agent.interpret(emptyItinerary, "我今天想去聽演唱會");
    expect(missing.output.command.action).toBe("ask_clarification");
    expect(missing.output.planningPhase).toBe("collecting");

    const awaiting = await agent.interpret(
      emptyItinerary,
      "從台北車站出發，10點出門，搭大眾運輸，晚上十點前回家。",
    );
    expect(awaiting.output.command.action).toBe("ask_clarification");
    expect(awaiting.output.planningStatus).toBe("awaiting_confirmation");

    const confirmed = await agent.interpret(emptyItinerary, "確認，就這樣安排");
    expect(confirmed.output.command.action).toBe("propose_day");
    expect(confirmed.output.planningStatus).toBe("ready");
    if (confirmed.output.command.action === "propose_day")
      expect(confirmed.output.command.stops).toHaveLength(2);
  });

  it("turns a start message into a navigation command", async () => {
    const output = await new FixtureItineraryAgent().interpret(emptyItinerary, "開始行程");
    expect(output.output.command).toEqual({ action: "start_navigation" });
  });

  it("turns a completion message into a typed command", async () => {
    const output = await new FixtureItineraryAgent().interpret(emptyItinerary, "完成行程");
    expect(output.output.command).toEqual({ action: "complete_navigation" });
  });

  it("drafts a typed notification without raw provider JSON", async () => {
    const output = await new FixtureItineraryAgent().draftNotification({
      currentStatus: "active",
      affectedLegIds: ["leg-1"],
      affectedStopIds: ["stop-1"],
      reasonCodes: ["flooded_segment"],
      evidenceIds: ["flood-1"],
      changes: [
        {
          legId: "leg-1",
          fromStopId: "origin",
          toStopId: "stop-1",
          fromLabel: "台北車站",
          toLabel: "演唱會",
          before: {
            status: "active",
            provider: "google",
            profile: "car",
            routeId: "google-direct",
            durationSeconds: 900,
            distanceMeters: 3000,
          },
          after: {
            status: "active",
            provider: "google",
            profile: "car",
            routeId: "gh-detour",
            durationSeconds: 1200,
            distanceMeters: 3500,
          },
          delta: { durationSeconds: 300, distanceMeters: 500 },
          reason: "道路積水禁止通行",
          tradeoffs: ["預估增加 5 分鐘"],
        },
      ],
    });
    expect(output.kind).toBe("service_disruption");
    expect(output.affectedLegIds).toEqual(["leg-1"]);
    expect(output.changes[0]?.after.provider).toBe("google");
  });
});
