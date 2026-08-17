import { describe, expect, it } from "vitest";
import {
  ConversationAgentOutputSchema,
  DayItinerarySnapshotSchema,
  ItineraryCommandSchema,
  ItineraryNotificationSchema,
} from "../src/contracts";

const point = (label: string, latitude: number, longitude: number) => ({
  label,
  coordinate: { latitude, longitude },
});

const stop = {
  title: "演唱會",
  location: point("台北小巨蛋", 25.0515, 121.5493),
  durationMinutes: 180,
  constraint: "fixed" as const,
  status: "planned" as const,
  evidenceIds: [],
};

describe("day itinerary contracts", () => {
  it("parses a Gemini proposal command with fixed and flexible stops", () => {
    const command = ItineraryCommandSchema.parse({
      action: "propose_day",
      date: "2026-08-17",
      startAt: "2026-08-17T10:00:00+08:00",
      endAt: "2026-08-17T22:00:00+08:00",
      origin: point("台北車站", 25.0478, 121.517),
      returnHome: true,
      stops: [stop, { ...stop, title: "咖啡", constraint: "flexible" }],
    });
    expect(command.action).toBe("propose_day");
  });

  it("parses agent output as message plus typed command", () => {
    const output = ConversationAgentOutputSchema.parse({
      message: "我先安排演唱會，再安排交通與晚餐。",
      planningStatus: "needs_details",
      command: { action: "start_navigation" },
    });
    expect(output.command.action).toBe("start_navigation");
  });

  it("rejects a snapshot with an active status but no stops", () => {
    expect(() =>
      DayItinerarySnapshotSchema.parse({
        id: "day-1",
        userId: "user-1",
        status: "active",
        revision: 1,
        date: "2026-08-17",
        returnHome: true,
        startAt: "2026-08-17T10:00:00+08:00",
        endAt: "2026-08-17T22:00:00+08:00",
        origin: point("台北車站", 25.0478, 121.517),
        stops: [],
        legs: [],
        signals: [],
        notifications: [],
        createdAt: "2026-08-17T09:00:00+08:00",
        updatedAt: "2026-08-17T09:00:00+08:00",
      }),
    ).toThrow();
  });

  it("parses a typed route update notification", () => {
    const notification = ItineraryNotificationSchema.parse({
      id: "notice-1",
      kind: "service_disruption",
      severity: "warning",
      title: "前往演唱會的路線需要更新",
      message: "原路線遇到淹水，已找到替代路線。",
      affectedLegIds: ["leg-1"],
      affectedStopIds: ["stop-1"],
      requiresConfirmation: false,
      evidenceIds: ["flood-1"],
      createdAt: "2026-08-17T16:00:00+08:00",
    });
    expect(notification.requiresConfirmation).toBe(false);
  });
});
