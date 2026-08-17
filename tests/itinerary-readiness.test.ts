import { describe, expect, it } from "vitest";
import { EmptyPlanningFacts, PlanningFactsSchema } from "../src/contracts";
import { assessPlanningReadiness } from "../src/lib/itinerary/readiness";

const completeFacts = PlanningFactsSchema.parse({
  origin: {
    status: "confirmed",
    value: { label: "台北車站", coordinate: { latitude: 25.0478, longitude: 121.517 } },
  },
  destinations: { status: "confirmed", value: ["台北小巨蛋"] },
  departureAt: { status: "confirmed", value: "2026-08-17T13:00:00+08:00" },
  endAt: { status: "confirmed", value: "2026-08-17T22:00:00+08:00" },
  fixedActivities: { status: "confirmed", value: [] },
  transportPreference: { status: "confirmed", value: "public_transit" },
  returnPlan: {
    status: "confirmed",
    value: {
      returnHome: true,
      location: { label: "台北車站", coordinate: { latitude: 25.0478, longitude: 121.517 } },
    },
  },
  constraints: { status: "confirmed", value: [] },
  assumptions: [],
  confirmation: "confirmed",
});

describe("itinerary readiness", () => {
  it("does not ready an empty request", () => {
    const result = assessPlanningReadiness(EmptyPlanningFacts);

    expect(result.ready).toBe(false);
    expect(result.missingFields).toEqual([
      "origin",
      "destinations",
      "departure_at",
      "end_at",
      "fixed_activities",
      "transport_preference",
      "return_plan",
      "constraints",
      "user_confirmation",
    ]);
  });

  it("requires an explicit transport preference and confirmation", () => {
    const result = assessPlanningReadiness({
      ...completeFacts,
      transportPreference: { status: "assumed", value: "car" },
      confirmation: "pending",
    });

    expect(result.ready).toBe(false);
    expect(result.missingFields).toEqual(["transport_preference", "user_confirmation"]);
  });

  it("accepts only confirmed complete facts", () => {
    expect(assessPlanningReadiness(completeFacts)).toEqual({
      ready: true,
      missingFields: [],
      assumptions: [],
    });
  });
});
