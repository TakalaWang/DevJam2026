import { describe, expect, it } from "vitest";
import {
  ActivityDiscoveryAgentOutputSchema,
  AgentInputSchema,
  AgentOutputSchemas,
  DailyReviewAgentOutputSchema,
  ItemReviewAgentOutputSchema,
  PlaceToolOutputSchema,
  RouteToolOutputSchema,
  ScheduleAgentOutputSchema,
  SearchEvidenceSchema,
  TravelAgentOutputSchema,
  type AgentInput,
  type AgentName,
  type TripSnapshot,
} from "../src/contracts";
import {
  AdkAgentRuntime,
  AgentOutputInvalidError,
  type AgentRuntime,
} from "../src/lib/workflow/adk";
import { TripOrchestrator } from "../src/lib/workflow/orchestrator";
import { TripStore } from "../src/lib/workflow/store";
import { validateSchedule } from "../src/lib/workflow/validator";

const flight = {
  id: "flight-1",
  kind: "flight" as const,
  provider: "demo",
  airline: "Routecraft Air",
  flightNumber: "RC101",
  origin: "TPE",
  destination: "KIX",
  departureAt: "2026-08-17T09:00:00+08:00",
  arrivalAt: "2026-08-17T13:00:00+09:00",
  evidenceIds: ["e-flight"],
};

const lodging = {
  id: "lodging-1",
  kind: "lodging" as const,
  provider: "demo",
  name: "Routecraft Hotel",
  address: "大阪市中央區",
  checkIn: "2026-08-17",
  checkOut: "2026-08-19",
  evidenceIds: ["e-lodging"],
};

class HappyPathRuntime implements AgentRuntime {
  async run<T>(
    agent: AgentName,
    _input: AgentInput,
    schema: { parse(value: unknown): T },
  ): Promise<T> {
    const outputs = {
      travel_boundary: {
        action: "present_candidates",
        message: "請確認航班與住宿。",
        candidates: [flight, lodging],
        evidenceIds: [],
      },
      daily_frame: {
        action: "save_frame",
        message: "每日框架已建立。",
        days: [
          { date: "2026-08-17", slots: [], activities: [], schedule: [], reviewStatus: "pending" },
        ],
        evidenceIds: [],
      },
      activity_discovery: {
        action: "save_activities",
        message: "已加入一個建議活動。",
        activities: [
          {
            id: "activity-1",
            name: "大阪城",
            category: "景點",
            location: "大阪城",
            durationMinutes: 90,
            status: "suggested",
            priority: "suggested",
            evidenceIds: [],
          },
        ],
        evidenceIds: [],
      },
      schedule: {
        action: "insert",
        message: "活動已提出排程。",
        targetActivityId: "activity-1",
        proposedScheduleItem: {
          id: "schedule-1",
          activityId: "activity-1",
          location: "大阪城",
          start: "2026-08-17T14:00:00+09:00",
          end: "2026-08-17T15:30:00+09:00",
          status: "draft",
          routeEvidenceId: "route-1",
        },
        evidenceIds: ["route-1"],
        evidence: [
          {
            id: "route-1",
            kind: "route",
            source: "Google Routes API",
            fetchedAt: "2026-08-17T00:00:00.000Z",
            summary: "大阪站到大阪城",
          },
        ],
      },
      item_review: {
        decision: "approved",
        message: "單項行程合理。",
        findings: [],
        suggestedChanges: [],
        evidenceIds: [],
      },
      daily_review: {
        decision: "approved",
        message: "整日行程合理。",
        findings: [],
        dayScore: 92,
        evidenceIds: [],
      },
    } as const;
    return schema.parse(outputs[agent]);
  }
}

describe("Zod agent contracts", () => {
  it("constructs all ADK agents with typed schemas and tools", () => {
    expect(() => new AdkAgentRuntime("test-key")).not.toThrow();
  });

  it("accepts the exact discriminated output and rejects incomplete actions", () => {
    expect(
      TravelAgentOutputSchema.parse({
        action: "present_candidates",
        message: "ok",
        candidates: [flight],
        evidenceIds: [],
      }),
    ).toMatchObject({ action: "present_candidates" });
    expect(() =>
      ScheduleAgentOutputSchema.parse({ action: "insert", message: "missing item" }),
    ).toThrow();
    expect(
      ItemReviewAgentOutputSchema.parse({
        decision: "approved",
        message: "ok",
        findings: [],
        suggestedChanges: [],
        evidenceIds: [],
      }),
    ).toMatchObject({ decision: "approved" });
    expect(
      DailyReviewAgentOutputSchema.parse({
        decision: "approved",
        message: "ok",
        findings: [],
        dayScore: 90,
        evidenceIds: [],
      }),
    ).toMatchObject({ dayScore: 90 });
    expect(
      ActivityDiscoveryAgentOutputSchema.parse({
        action: "save_activities",
        message: "ok",
        activities: [],
        evidenceIds: [],
      }),
    ).toMatchObject({ action: "save_activities" });
    expect(
      AgentOutputSchemas.schedule.parse({ action: "complete", message: "done", evidenceIds: [] }),
    ).toMatchObject({ action: "complete" });
  });

  it("requires a typed agent input snapshot", () => {
    expect(() =>
      AgentInputSchema.parse({ tripId: "trip-1", userMessage: "hello", snapshot: {} }),
    ).toThrow();
  });

  it("validates tool evidence and deterministic schedule findings", () => {
    expect(
      RouteToolOutputSchema.parse({
        status: "unavailable",
        reason: "missing key",
      }),
    ).toMatchObject({ status: "unavailable" });
    expect(
      SearchEvidenceSchema.parse({
        id: "search-1",
        kind: "search",
        source: "Google Search grounding",
        fetchedAt: "2026-08-17T00:00:00.000Z",
        summary: "result",
        query: "大阪城",
        sourceUrls: ["https://example.com/osaka"],
      }),
    ).toMatchObject({ kind: "search" });
    expect(() => PlaceToolOutputSchema.parse({ status: "ok", name: "missing evidence" })).toThrow();
    const validation = validateSchedule(
      { date: "2026-08-17", slots: [], activities: [], schedule: [], reviewStatus: "pending" },
      {
        id: "bad-time",
        activityId: "activity-1",
        location: "大阪城",
        start: "not-a-date",
        end: "2026-08-17T10:00:00+09:00",
        status: "draft",
      },
    );
    expect(validation.valid).toBe(false);
    expect(validation.findings[0]?.code).toBe("invalid_time");
  });
});

describe("TripOrchestrator", () => {
  it("runs the typed workflow without touching the frontend", async () => {
    const store = new TripStore(":memory:");
    const orchestrator = new TripOrchestrator(store, () => new HappyPathRuntime());
    let snapshot = orchestrator.createTrip("user-1");

    const firstProcess = await orchestrator.process(snapshot.id, {
      type: "message",
      message: "我要去大阪旅遊",
    });
    ({ snapshot } = firstProcess);
    expect(snapshot.status).toBe("flight_confirmation");
    expect(snapshot.travelCandidates).toHaveLength(2);
    expect(firstProcess.run.events).toHaveLength(2);

    ({ snapshot } = await orchestrator.process(snapshot.id, {
      type: "confirm_flight",
      candidateId: "flight-1",
    }));
    ({ snapshot } = await orchestrator.process(snapshot.id, {
      type: "confirm_lodging",
      candidateId: "lodging-1",
    }));
    expect(snapshot.status).toBe("slot_confirmation");

    ({ snapshot } = await orchestrator.process(snapshot.id, {
      type: "message",
      message: "每天八點起床，晚上十點睡覺",
    }));
    ({ snapshot } = await orchestrator.process(snapshot.id, {
      type: "message",
      message: "想看大阪城",
    }));
    ({ snapshot } = await orchestrator.process(snapshot.id, {
      type: "message",
      message: "請開始安排",
    }));
    expect(snapshot.status).toBe("daily_review");
    expect(snapshot.evidence[0]?.kind).toBe("route");

    ({ snapshot } = await orchestrator.process(snapshot.id, {
      type: "message",
      message: "請審核整天行程",
    }));
    expect(snapshot.status).toBe("awaiting_user_confirmation");

    ({ snapshot } = await orchestrator.process(snapshot.id, { type: "confirm_plan" }));
    expect(snapshot.status).toBe("final");
    expect(snapshot.days[0]?.schedule).toEqual([
      expect.objectContaining({
        activityId: "activity-1",
        start: "2026-08-17T14:00:00+09:00",
        end: "2026-08-17T15:30:00+09:00",
        status: "approved",
      }),
    ]);
    expect(snapshot.days[0]?.reviewStatus).toBe("approved");
    expect(snapshot.revision).toBeGreaterThan(0);
    store.close();
  });

  it("does not mutate the trip when an agent output is invalid", async () => {
    const store = new TripStore(":memory:");
    const runtime: AgentRuntime = {
      run: async () => {
        throw new AgentOutputInvalidError("schema invalid");
      },
    };
    const orchestrator = new TripOrchestrator(store, () => runtime);
    const before = orchestrator.createTrip("user-1");

    await expect(
      orchestrator.process(before.id, { type: "message", message: "我要去大阪" }),
    ).rejects.toThrow("schema invalid");

    const after = orchestrator.getTrip(before.id) as TripSnapshot;
    const run = orchestrator.getLatestRun(before.id);
    expect(after.revision).toBe(before.revision);
    expect(after.status).toBe("intake");
    expect(run?.status).toBe("failed");
    expect(run?.error?.code).toBe("agent_output_invalid");
    store.close();
  });
});
